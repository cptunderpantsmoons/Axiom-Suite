// Command proxy is the Management Harness AI proxy gateway (OpenAI-compatible).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"go.uber.org/zap"

	apimw "github.com/laiw/management-harness/internal/api/middleware"

	"github.com/laiw/management-harness/internal/bootstrap"
	"github.com/laiw/management-harness/internal/components/auth"
	"github.com/laiw/management-harness/internal/components/guardian"
	"github.com/laiw/management-harness/internal/components/skills"
	"github.com/laiw/management-harness/internal/core/deps"
	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

// proxyRequestsPerMinute caps the per-key request rate for the proxy gateway.
const proxyRequestsPerMinute = 6000

type ctxKeyReqID int

const reqIDKey ctxKeyReqID = iota

// requestIDMiddleware assigns a correlation ID (or echoes the inbound one) and
// stamps it on the response so requests can be traced across the system.
func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), reqIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func requestIDFromContext(ctx context.Context) string {
	if id, ok := ctx.Value(reqIDKey).(string); ok {
		return id
	}
	return ""
}

func main() {
	configFile := os.Getenv("MH_CONFIG_FILE")
	d, err := bootstrap.Build(configFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to bootstrap: %v\n", err)
		os.Exit(1)
	}
	defer bootstrap.Shutdown(d)

	router := setupRouter(d)
	addr := fmt.Sprintf("%s:%d", d.Config.Server.Host, d.Config.Server.Port)
	zap.L().Info("starting proxy", zap.String("addr", addr))

	srv := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  d.Config.Server.ReadTimeout,
		WriteTimeout: d.Config.Server.WriteTimeout,
		IdleTimeout:  d.Config.Server.IdleTimeout,
	}
	go func() {
		var err error
		if d.Config.Server.TLSEnabled {
			zap.L().Info("proxy listening with TLS")
			err = srv.ListenAndServeTLS(d.Config.Server.TLSCert, d.Config.Server.TLSKey)
		} else {
			err = srv.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			zap.L().Fatal("proxy server error", zap.Error(err))
		}
	}()

	gracefulShutdown(srv)
}

func setupRouter(d *deps.Dependencies) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(clientIPMiddleware(d.Config.Server.TrustedProxies))
	r.Use(requestIDMiddleware)
	r.Use(apimw.NewRateLimiter(proxyRequestsPerMinute, time.Minute).Middleware)
	r.Use(maxBytesMiddleware(int64(d.Config.Proxy.MaxRequestBytes)))

	r.Handle("/metrics", d.Metrics.Handler())
	r.Get("/healthz", handleHealth)
	r.Get("/readyz", handleReady(d))
	r.Get("/livez", handleLive)

	if d.Config.Proxy.RequireAuth {
		r.Group(func(r chi.Router) {
			r.Use(d.Auth.Middleware)
			registerProxyRoutes(r, d)
		})
	} else {
		registerProxyRoutes(r, d)
	}
	return r
}

func registerProxyRoutes(r chi.Router, d *deps.Dependencies) {
	r.Post("/v1/chat/completions", handleChatCompletion(d))
	r.Post("/v1/chat/completions/stream", handleChatStream(d))
	r.Post("/v1/messages", handleAnthropicMessages(d))
}

func handleChatCompletion(d *deps.Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		req, ok := resolveRequest(w, r, d)
		if !ok {
			return
		}
		provider := selectProvider(d, r.Context(), req)
		if provider == nil {
			d.Metrics.RecordRequest("none", req.Model, "unavailable", time.Since(start))
			writeErr(w, http.StatusServiceUnavailable, "no provider available")
			return
		}
		cost, allowed := enforceBudget(d, r, req, provider)
		if !allowed {
			writeErr(w, http.StatusPaymentRequired, "budget limit exceeded")
			d.Metrics.RecordBudgetExceeded(provider.Name())
			auditProxy(d, r, "proxy.request", "budget_exceeded")
			return
		}
		cacheKey := cacheNamespace(r, provider)
		if d.Cache != nil {
			if cached, err := d.Cache.GetFor(r.Context(), cacheKey, req); err == nil && cached != nil && cached.Response != nil {
				resp := cloneChatResponse(cached.Response)
				if len(resp.Choices) > 0 {
					if redacted, _ := d.Guardian.ScanResponse(r.Context(), resp.Choices[0].Message.Content); !redacted.IsSafe {
						resp.Choices[0].Message.Content = redacted.RedactedResponse
					}
				}
				d.Metrics.RecordCache("hit")
				d.Metrics.RecordRequest(provider.Name(), req.Model, "cache_hit", time.Since(start))
				recordBudget(d, r, 0, 0)
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(resp)
				auditProxy(d, r, "proxy.request", "cache_hit")
				return
			}
			d.Metrics.RecordCache("miss")
		}
		start = time.Now()
		resp, err := provider.ChatCompletion(r.Context(), req)
		d.Metrics.RecordRequest(provider.Name(), req.Model, statusOf(err), time.Since(start))
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			auditProxy(d, r, "proxy.request", "failure")
			return
		}
		d.Metrics.RecordTokens(provider.Name(), req.Model, "prompt", resp.Usage.PromptTokens)
		d.Metrics.RecordTokens(provider.Name(), req.Model, "completion", resp.Usage.CompletionTokens)
		recordBudget(d, r, cost, resp.Usage.TotalTokens)
		recordCost(d, r, provider, req.Model, resp.Usage)
		if d.Cache != nil {
			_ = d.Cache.SetFor(r.Context(), cacheKey, req, resp)
		}

		if len(resp.Choices) > 0 {
			if redacted, _ := d.Guardian.ScanResponse(r.Context(), resp.Choices[0].Message.Content); !redacted.IsSafe {
				resp.Choices[0].Message.Content = redacted.RedactedResponse
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
		auditProxy(d, r, "proxy.request", "success")
	}
}

func handleChatStream(d *deps.Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		req, ok := resolveRequest(w, r, d)
		if !ok {
			return
		}
		provider := selectProvider(d, r.Context(), req)
		if provider == nil {
			d.Metrics.RecordRequest("none", req.Model, "unavailable", time.Since(start))
			writeErr(w, http.StatusServiceUnavailable, "no provider available")
			return
		}
		cost, allowed := enforceBudget(d, r, req, provider)
		if !allowed {
			d.Metrics.RecordRequest(provider.Name(), req.Model, "budget_exceeded", time.Since(start))
			writeErr(w, http.StatusPaymentRequired, "budget limit exceeded")
			d.Metrics.RecordBudgetExceeded(provider.Name())
			auditProxy(d, r, "proxy.request", "budget_exceeded")
			return
		}
		chunks, err := provider.ChatCompletionStream(r.Context(), req)
		if err != nil {
			d.Metrics.RecordRequest(provider.Name(), req.Model, statusOf(err), time.Since(start))
			writeErr(w, http.StatusBadGateway, err.Error())
			auditProxy(d, r, "proxy.request", "failure")
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		var totalTokens int
		completed := false
		streamFailed := false
		for chunk := range chunks {
			if chunk == nil {
				continue
			}
			if chunk.Error != "" {
				streamFailed = true
				writeStreamError(w, chunk.Error)
				break
			}
			if chunk.Done {
				completed = true
				break
			}
			if len(chunk.Choices) > 0 {
				content := chunk.Choices[0].Delta.Content
				if d.Config.Guardian.Enabled && d.Config.Guardian.RedactPII {
					if sanitized, err := d.Guardian.ScanResponse(r.Context(), content); err == nil {
						content = sanitized.RedactedResponse
						chunk.Choices[0].Delta.Content = content
					}
				}
				totalTokens += len(content) / 4
			}
			b, _ := json.Marshal(chunk)
			_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
			if flusher != nil {
				flusher.Flush()
			}
		}
		if !completed && !streamFailed {
			streamFailed = true
			writeStreamError(w, "upstream stream ended before completion")
		}
		if completed {
			_, _ = w.Write([]byte("data: [DONE]\n\n"))
		}
		recordBudget(d, r, cost, totalTokens)
		recordCost(d, r, provider, req.Model, models.Usage{CompletionTokens: totalTokens})
		d.Metrics.RecordTokens(provider.Name(), req.Model, "completion", totalTokens)
		status := "success"
		outcome := "success"
		if streamFailed {
			status = "error"
			outcome = "failure"
		}
		d.Metrics.RecordRequest(provider.Name(), req.Model, status, time.Since(start))
		auditProxy(d, r, "proxy.request", outcome)
	}
}

func handleAnthropicMessages(d *deps.Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		req, ok := resolveRequest(w, r, d)
		if !ok {
			return
		}
		provider := selectProvider(d, r.Context(), req)
		if provider == nil {
			d.Metrics.RecordRequest("none", req.Model, "unavailable", time.Since(start))
			writeErr(w, http.StatusServiceUnavailable, "no provider available")
			return
		}
		cost, allowed := enforceBudget(d, r, req, provider)
		if !allowed {
			d.Metrics.RecordRequest(provider.Name(), req.Model, "budget_exceeded", time.Since(start))
			writeErr(w, http.StatusPaymentRequired, "budget limit exceeded")
			d.Metrics.RecordBudgetExceeded(provider.Name())
			auditProxy(d, r, "proxy.request", "budget_exceeded")
			return
		}
		resp, err := provider.ChatCompletion(r.Context(), req)
		d.Metrics.RecordRequest(provider.Name(), req.Model, statusOf(err), time.Since(start))
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			auditProxy(d, r, "proxy.request", "failure")
			return
		}
		recordBudget(d, r, cost, resp.Usage.TotalTokens)
		recordCost(d, r, provider, req.Model, resp.Usage)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
		auditProxy(d, r, "proxy.request", "success")
	}
}

func resolveRequest(w http.ResponseWriter, r *http.Request, d *deps.Dependencies) (*models.ChatRequest, bool) {
	if redacted, ok := guardian.RedactedRequestFrom(r.Context()); ok {
		return redacted, true
	}
	var req models.ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeErr(w, http.StatusRequestEntityTooLarge, "request body too large")
			return nil, false
		}
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return nil, false
	}
	if err := validateAxiomRequest(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid Axiom envelope: "+err.Error())
		return nil, false
	}
	if req.Axiom != nil {
		attachAxiomEnvelope(r, req.Axiom)
		// Axiom metadata is gateway-local and must never reach an upstream provider.
		req.Axiom = nil
	}
	if !guardianGate(w, d, r, &req) {
		return nil, false
	}

	// Skill resolution: expand the referenced skill into the final messages and
	// strip the gateway-local skill fields before forwarding upstream.
	if req.Skill != "" {
		identity, _ := auth.IdentityFromContext(r.Context())
		skill, err := d.SkillEngine.Resolve(req.Skill, identity)
		if err != nil {
			if errors.Is(err, skills.ErrForbidden) {
				writeErr(w, http.StatusForbidden, "skill not authorized")
			} else {
				writeErr(w, http.StatusNotFound, "unknown skill")
			}
			return nil, false
		}
		messages, err := skills.Expand(skill, req.SkillParams)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "invalid skill parameters: "+err.Error())
			return nil, false
		}
		req.Messages = messages
		req.Skill = ""
		req.SkillParams = nil

		// Re-scan the assembled prompt: client-controlled skill_params values are
		// now in the messages, so the guardian must inspect the final prompt
		// before it is forwarded (injection / PII). Runs before optimisation.
		if !guardianGate(w, d, r, &req) {
			return nil, false
		}

		if skill.Optimize {
			optimizeMessages(d, &req, skill.Name)
		}
	}

	if !policyGate(w, d, r, &req) {
		return nil, false
	}

	return &req, true
}

// policyGate evaluates the effective request against the active policy engine.
// It runs after skill expansion and guardian scanning so policies inspect the
// exact prompt that will be sent upstream.
func policyGate(w http.ResponseWriter, d *deps.Dependencies, r *http.Request, req *models.ChatRequest) bool {
	if d.PolicyEngine == nil {
		return true
	}
	identity, _ := auth.IdentityFromContext(r.Context())
	result, err := d.PolicyEngine.Evaluate(r.Context(), req, identity)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "policy evaluation failed")
		auditProxy(d, r, "policy.evaluate", "failure")
		return false
	}
	if !result.Allowed {
		message := result.Message
		if message == "" {
			message = "request blocked by policy"
		}
		writeErr(w, http.StatusForbidden, message)
		auditProxy(d, r, "policy.block", "blocked")
		if d.Metrics != nil {
			d.Metrics.RecordThreat("policy", "high")
		}
		return false
	}
	if result.Action == "route" && result.Params != nil {
		if preferred, ok := result.Params["preferred_provider"].(string); ok && preferred != "" {
			if req.Metadata == nil {
				req.Metadata = map[string]string{}
			}
			req.Metadata["preferred_provider"] = preferred
		}
	}
	return true
}

// guardianGate runs the guardian scan on the request's current messages,
// blocking on injection/jailbreak and applying PII redaction. Returns false when
// the request must be rejected (an error response has already been written).
func guardianGate(w http.ResponseWriter, d *deps.Dependencies, r *http.Request, req *models.ChatRequest) bool {
	if !d.Config.Guardian.Enabled {
		return true
	}
	res, err := d.Guardian.ScanRequest(r.Context(), req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "guardian error")
		return false
	}
	for _, t := range res.Threats {
		if (t.Type == models.ThreatPromptInjection && d.Config.Guardian.BlockInjection) ||
			(t.Type == models.ThreatJailbreak && d.Config.Guardian.BlockJailbreak) {
			writeErr(w, http.StatusForbidden, "request blocked by security policy")
			return false
		}
	}
	if res.RedactedMessages != nil {
		req.Messages = res.RedactedMessages
	}
	return true
}

// optimizeMessages applies lossless prompt normalisation to user-role messages
// and records the approximate token savings in the optimizer metrics.
func optimizeMessages(d *deps.Dependencies, req *models.ChatRequest, skillName string) {
	var saved int
	for i := range req.Messages {
		if req.Messages[i].Role != "user" {
			continue
		}
		before := len(req.Messages[i].Content)
		res, err := d.Optimizer.Optimize(context.Background(), req.Messages[i].Content, nil)
		if err != nil || !res.Applied {
			continue
		}
		req.Messages[i].Content = res.Optimized
		saved += before - len(res.Optimized)
	}
	if saved > 0 {
		d.Metrics.RecordOptimization(skillName, saved/4)
		if d.Savings != nil {
			d.Savings.AddSaved(skillName, saved/4)
		}
	}
}

func selectProvider(d *deps.Dependencies, ctx context.Context, req *models.ChatRequest) interfaces.LLMProvider {
	providers := d.Providers.Snapshot()
	if preferred, ok := req.Metadata["preferred_provider"]; ok && preferred != "" {
		// preferred_provider is a gateway-internal routing hint: never forward it
		// upstream or include it in the response cache key.
		delete(req.Metadata, "preferred_provider")
		if p, ok := providers[preferred]; ok {
			return p
		}
	}
	// Prefer the model router's cost/health-aware decision when available.
	if d.Config.Proxy.RequireAuth || len(providers) > 1 {
		if decision, err := d.Router.RouteWithPreferred(ctx, req, d.Config.Proxy.DefaultProvider); err == nil {
			if p, ok := providers[decision.Provider]; ok {
				return p
			}
		}
	}
	if p, ok := providers[d.Config.Proxy.DefaultProvider]; ok {
		return p
	}
	for _, p := range providers {
		return p
	}
	return nil
}

// enforceBudget estimates the request cost and enforces the per-identity budget.
func enforceBudget(d *deps.Dependencies, r *http.Request, req *models.ChatRequest, provider interfaces.LLMProvider) (float64, bool) {
	cost := estimatedCost(d, req, provider)
	if !d.Config.Proxy.RequireAuth {
		return cost, true
	}
	identity, ok := auth.IdentityFromContext(r.Context())
	if !ok {
		return cost, true
	}
	if err := d.Budget.Check(r.Context(), identity, cost); err != nil {
		return cost, false
	}
	return cost, true
}

// estimatedCost prices the request's implied token usage through the configured
// Pricing (GPU-hour for local providers, token table otherwise) so the budget
// pre-check agrees with post-usage accounting. Falls back to the provider's own
// estimate on error.
func estimatedCost(d *deps.Dependencies, req *models.ChatRequest, provider interfaces.LLMProvider) float64 {
	cost, err := d.Pricing.Price(provider.Name(), req.Model, estimateUsage(req))
	if err != nil {
		if est, e2 := provider.EstimateCost(context.Background(), req); e2 == nil {
			return est
		}
	}
	return cost
}

// estimateUsage approximates prompt/completion token counts from a request.
func estimateUsage(req *models.ChatRequest) models.Usage {
	var chars int
	for _, m := range req.Messages {
		chars += len(m.Content)
	}
	prompt := chars / 4
	out := 256
	if req.MaxTokens != nil {
		out = *req.MaxTokens
	}
	return models.Usage{PromptTokens: prompt, CompletionTokens: out, TotalTokens: prompt + out}
}

// recordCost records the per-identity USD cost of a successful request so the
// harness_budget_cost_total_usd metric reflects real spend. It is a no-op when
// the request is unauthenticated (no identity to attribute the cost to).
func cacheNamespace(r *http.Request, provider interfaces.LLMProvider) string {
	identity, _ := auth.IdentityFromContext(r.Context())
	if identity == nil {
		return "anonymous:" + provider.Name()
	}
	return identity.UserID + ":" + identity.TeamID + ":" + provider.Name()
}

func cloneChatResponse(resp *models.ChatResponse) *models.ChatResponse {
	if resp == nil {
		return nil
	}
	copy := *resp
	copy.Choices = append([]models.Choice(nil), resp.Choices...)
	return &copy
}

func recordCost(d *deps.Dependencies, r *http.Request, provider interfaces.LLMProvider, model string, usage models.Usage) {
	if !d.Config.Proxy.RequireAuth {
		return
	}
	identity, ok := auth.IdentityFromContext(r.Context())
	if !ok {
		return
	}
	cost, err := d.Pricing.Price(provider.Name(), model, usage)
	if err != nil {
		return
	}
	d.Metrics.RecordCost(identity.UserID, identity.TeamID, provider.Name(), cost)
}

// recordBudget persists spend/usage after a successful request.
func recordBudget(d *deps.Dependencies, r *http.Request, cost float64, tokens int) {
	if !d.Config.Proxy.RequireAuth {
		return
	}
	if identity, ok := auth.IdentityFromContext(r.Context()); ok {
		_ = d.Budget.RecordUsage(r.Context(), identity, cost, tokens)
	}
}

func statusOf(err error) string {
	if err != nil {
		return "error"
	}
	return "success"
}

func auditProxy(d *deps.Dependencies, r *http.Request, action, outcome string) {
	identity, _ := auth.IdentityFromContext(r.Context())
	userID, teamID, keyID := "", "", ""
	if identity != nil {
		userID, teamID, keyID = identity.UserID, identity.TeamID, identity.APIKeyID
	}
	clientIP := middleware.GetClientIP(r.Context())
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}
	_ = d.Audit.Log(r.Context(), &models.AuditEvent{
		UserID:    userID,
		TeamID:    teamID,
		APIKeyID:  keyID,
		RequestID: requestIDFromContext(r.Context()),
		Action:    action,
		Resource:  r.URL.Path,
		Outcome:   outcome,
		Details:   axiomAuditDetails(r),
		IPAddress: clientIP,
		UserAgent: r.UserAgent(),
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSONStatus(w, http.StatusOK, map[string]string{"status": "healthy"})
}
func handleReady(d *deps.Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Readiness uses a detached context with its own deadline so a slow or
		// cancelled client cannot break the probe. It verifies the dependencies
		// the proxy needs to serve traffic: the budget store (when present) and
		// at least one reachable provider.
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		if d.BudgetStore != nil {
			if err := d.BudgetStore.Ping(ctx); err != nil {
				writeJSONStatus(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready", "reason": "budget store unreachable"})
				return
			}
		}

		providers := d.Providers.Snapshot()
		if len(providers) > 0 {
			healthy := false
			for _, p := range providers {
				if p.HealthCheck(ctx) == nil {
					healthy = true
					break
				}
			}
			if !healthy {
				writeJSONStatus(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready", "reason": "no healthy providers"})
				return
			}
		}
		writeJSONStatus(w, http.StatusOK, map[string]string{"status": "ready"})
	}
}
func handleLive(w http.ResponseWriter, r *http.Request) {
	writeJSONStatus(w, http.StatusOK, map[string]string{"status": "alive"})
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSONStatus(w, status, map[string]string{"error": msg})
}

func writeStreamError(w http.ResponseWriter, msg string) {
	b, _ := json.Marshal(map[string]string{"error": msg})
	_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", b)
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func writeJSONStatus(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func gracefulShutdown(srv *http.Server) {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	zap.L().Info("shutting down proxy")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

// clientIPMiddleware derives the trusted client IP for rate limiting and
// logging. Forwarded headers are only honored from the configured proxy CIDRs;
// when none are configured the TCP peer address is used, which a client cannot
// spoof. This replaces the deprecated chi middleware.RealIP.
func clientIPMiddleware(trustedProxies []string) func(http.Handler) http.Handler {
	if len(trustedProxies) > 0 {
		return middleware.ClientIPFromXFF(trustedProxies...)
	}
	return middleware.ClientIPFromRemoteAddr
}

// maxBytesMiddleware caps the request body size to prevent unbounded reads.
func maxBytesMiddleware(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}
