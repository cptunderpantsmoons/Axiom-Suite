// Package api implements the Management Harness management REST API.
package api

import (
	"context"
	"fmt"
	"net/http"
	"time"
	"sort"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/cors"
	"go.uber.org/zap"

	"github.com/laiw/management-harness/internal/api/middleware"
	"github.com/laiw/management-harness/internal/core/config"
	"github.com/laiw/management-harness/internal/core/deps"
	"github.com/laiw/management-harness/internal/web"
)

// Server is the management REST API server.
type Server struct {
	cfg      *config.Config
	deps     *deps.Dependencies
	users    UserStore
	policies policyStoreBackend
	router   *chi.Mux
	httpSrv  *http.Server
	log      *zap.Logger
}

// NewServer constructs the management API server.
func NewServer(cfg *config.Config, d *deps.Dependencies) *Server {
	var users UserStore = NewMemoryUserStore()
	var policies policyStoreBackend = newPolicyStore()
	if cfg.Redis.Enabled && d != nil && d.RedisClient != nil {
		users = NewRedisUserStore(d.RedisClient)
		policies = newRedisPolicyStore(d.RedisClient)
	}
	s := &Server{
		cfg:      cfg,
		deps:     d,
		users:    users,
		policies: policies,
		log:      zap.L().Named("manager"),
	}
	s.router = s.setupRoutes()
	return s
}

// Router exposes the configured router (used by embedding servers).
func (s *Server) Router() http.Handler { return s.router }

func (s *Server) setupRoutes() *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.NewRateLimiter(1000, time.Minute).Middleware)
	// Apply the same hard body limit to manager endpoints as the proxy. This
	// prevents large configuration/admin payloads from bypassing the gateway's
	// request-size protection.
	maxRequestBytes := int64(s.cfg.Proxy.MaxRequestBytes)
	if maxRequestBytes <= 0 {
		maxRequestBytes = 4 << 20
	}
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			req.Body = http.MaxBytesReader(w, req.Body, maxRequestBytes)
			next.ServeHTTP(w, req)
		})
	})
	r.Use(cors.New(cors.Options{
		AllowedOrigins: s.cfg.Manager.AllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Authorization", "Content-Type", "X-Request-ID"},
	}).Handler)

	authMw := middleware.JWTAuth(middleware.AuthConfig{
		JWTSecret:  s.cfg.Manager.JWTSecret,
		AdminToken: s.cfg.Manager.AdminToken,
	})
	adminMw := middleware.RequireAdmin()

	// Unauthenticated observability endpoints (parity with the proxy).
	r.Handle("/metrics", s.deps.Metrics.Handler())
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/readyz", s.handleReady)
	r.Get("/livez", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "alive"})
	})

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(authMw)

		// Read endpoints: any authenticated principal.
		r.Get("/users", s.handleListUsers)
		r.Get("/users/{id}", s.handleGetUser)
		r.Get("/users/{id}/keys", s.handleListKeys)
		r.Get("/users/{id}/budget", s.handleGetBudget)
		r.Get("/budget/usage", s.handleGetUsage)
		r.Get("/policies", s.handleListPolicies)
		r.Get("/audit/events", s.handleListAuditEvents)
		r.Get("/audit/verify", s.handleVerifyAudit)
		r.Get("/config", s.handleGetConfig)
		r.Get("/overview", s.handleOverview)
		r.Get("/cost", s.handleCost)
		r.Get("/provenance", s.handleProvenanceInfo)
		r.Post("/provenance/verify", s.handleProvenanceVerify)
		r.Get("/skills", s.handleListSkills)
		r.Get("/skills/{name}", s.handleGetSkill)

		// Mutating endpoints: admin only.
		r.With(adminMw).Post("/users", s.handleCreateUser)
		r.With(adminMw).Put("/users/{id}", s.handleUpdateUser)
		r.With(adminMw).Delete("/users/{id}", s.handleDeleteUser)
		r.With(adminMw).Post("/users/{id}/keys", s.handleCreateKey)
		r.With(adminMw).Post("/users/{id}/keys/{key_id}/revoke", s.handleRevokeKey)
		r.With(adminMw).Put("/users/{id}/budget", s.handleSetBudget)
		r.With(adminMw).Post("/policies", s.handleCreatePolicy)
		r.With(adminMw).Put("/policies/{id}", s.handleUpdatePolicy)
		r.With(adminMw).Post("/policies/{id}/activate", s.handleActivatePolicy)
		r.With(adminMw).Put("/config", s.handlePutConfig)
		r.With(adminMw).Post("/skills", s.handleCreateSkill)
		r.With(adminMw).Post("/skills/draft", s.handleDraftSkill)
		// Minting a provenance attestation is privileged (it attests a source such as human).
		r.With(adminMw).Post("/provenance/sign", s.handleProvenanceSign)
		r.With(adminMw).Put("/skills/{name}", s.handleUpdateSkill)
		r.With(adminMw).Delete("/skills/{name}", s.handleDeleteSkill)
		r.With(adminMw).Get("/audit/export", s.handleExportAudit)
	})

	r.NotFound(web.Handler().ServeHTTP)
	return r
}

func (s *Server) handleOverview(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	users, _ := s.users.List(ctx)
	policies, _ := s.policies.list(ctx)
	events := s.auditEvents()

	activePolicies := 0
	for _, p := range policies {
		if p.Active {
			activePolicies++
		}
	}

	activeProviders := s.deps.Providers.Snapshot()
	providerNames := make([]string, 0, len(activeProviders))
	for name := range activeProviders {
		providerNames = append(providerNames, name)
	}
	sort.Strings(providerNames)

	requests := 0
	threatsBlocked := 0
	for _, e := range events {
		if e.Action == "proxy.request" {
			requests++
		}
		if e.Outcome == "blocked" || strings.HasPrefix(e.Action, "guardian.") {
			threatsBlocked++
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"requests":            requests,
		"threats_blocked":     threatsBlocked,
		"users_count":         len(users),
		"active_policies":     activePolicies,
		"providers":           providerNames,
		"audit_events_count":  len(events),
	})
}

// handleReady verifies the manager's dependencies are reachable. It uses a
// detached context with its own deadline so client cancellation does not affect
// the probe.
func (s *Server) handleReady(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if s.deps.BudgetStore != nil {
		if err := s.deps.BudgetStore.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready", "reason": "budget store unreachable"})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

// Start launches the HTTP server.
func (s *Server) Start() error {
	addr := fmt.Sprintf("%s:%d", s.cfg.Manager.Host, s.cfg.Manager.Port)
	s.log.Info("starting management API", zap.String("addr", addr))
	s.httpSrv = &http.Server{
		Addr:         addr,
		Handler:      s.router,
		ReadTimeout:  s.cfg.Server.ReadTimeout,
		WriteTimeout: s.cfg.Server.WriteTimeout,
		IdleTimeout:  s.cfg.Server.IdleTimeout,
	}
	var err error
	if s.cfg.Server.TLSEnabled {
		s.log.Info("management API listening with TLS")
		err = s.httpSrv.ListenAndServeTLS(s.cfg.Server.TLSCert, s.cfg.Server.TLSKey)
	} else {
		err = s.httpSrv.ListenAndServe()
	}
	if err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpSrv == nil {
		return nil
	}
	return s.httpSrv.Shutdown(ctx)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = encodeJSON(w, v)
}
