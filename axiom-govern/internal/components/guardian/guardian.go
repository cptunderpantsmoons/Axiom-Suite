// Package guardian implements prompt-injection, jailbreak, and PII protection.
package guardian

import (
	"context"
	"net/http"

	"go.uber.org/zap"

	"github.com/laiw/management-harness/internal/core/models"
)

// OutputSanitizer sanitizes model responses before returning them to the client.
type OutputSanitizer interface {
	Sanitize(ctx context.Context, response string) (string, []PIIFinding)
}

// DefaultOutputSanitizer redacts PII from responses using the PIIRedactor.
type DefaultOutputSanitizer struct {
	redactor *PIIRedactor
}

// NewDefaultOutputSanitizer constructs a default output sanitizer.
func NewDefaultOutputSanitizer() *DefaultOutputSanitizer {
	return &DefaultOutputSanitizer{redactor: NewPIIRedactor()}
}

// Sanitize implements OutputSanitizer.
func (s *DefaultOutputSanitizer) Sanitize(ctx context.Context, response string) (string, []PIIFinding) {
	return s.redactor.RedactResponse(ctx, response)
}

// Options configures Guardian behavior.
type Options struct {
	BlockInjection bool
	BlockJailbreak bool
	RedactPII      bool
}

// Guardian scans requests and responses for security threats.
type Guardian struct {
	injectionDetector InjectionDetector
	jailbreakDetector JailbreakDetector
	piiRedactor       *PIIRedactor
	outputSanitizer   OutputSanitizer
	opts              Options
	log               *zap.Logger
}

// NewGuardian constructs a Guardian with the given detectors.
func NewGuardian(injectionDetector InjectionDetector, piiRedactor *PIIRedactor, jailbreakDetector JailbreakDetector) *Guardian {
	if injectionDetector == nil {
		injectionDetector = DefaultInjectionDetector{}
	}
	if jailbreakDetector == nil {
		jailbreakDetector = DefaultJailbreakDetector{}
	}
	if piiRedactor == nil {
		piiRedactor = NewPIIRedactor()
	}
	return &Guardian{
		injectionDetector: injectionDetector,
		jailbreakDetector: jailbreakDetector,
		piiRedactor:       piiRedactor,
		outputSanitizer:   NewDefaultOutputSanitizer(),
		opts:              Options{BlockInjection: true, BlockJailbreak: true, RedactPII: true},
		log:               zap.L().Named("guardian"),
	}
}

// WithOptions overrides guardian options.
func (g *Guardian) WithOptions(opts Options) *Guardian {
	g.opts = opts
	return g
}

// ScanRequest scans a request for injection, jailbreak, and PII threats.
func (g *Guardian) ScanRequest(ctx context.Context, req *models.ChatRequest) (*models.SecurityScanResult, error) {
	result := &models.SecurityScanResult{IsSafe: true, Confidence: 0.9}
	var redactedMessages []models.Message

	if g.opts.RedactPII {
		msgs, findings := g.piiRedactor.Redact(ctx, req.Messages)
		redactedMessages = msgs
		if len(findings) > 0 {
			result.Threats = append(result.Threats, models.Threat{
				Type:     models.ThreatPIIFound,
				Severity: models.SeverityMedium,
				Details:  "PII redacted from request",
			})
			result.IsSafe = false
		}
	} else {
		redactedMessages = req.Messages
	}

	if inj, detected := g.injectionDetector.Detect(ctx, redactedMessages); detected {
		result.IsSafe = false
		result.Threats = append(result.Threats, models.Threat{
			Type:     models.ThreatPromptInjection,
			Severity: models.SeverityHigh,
			Details:  joinMatches(inj.Matches),
		})
	}

	if jb, detected := g.jailbreakDetector.Detect(ctx, redactedMessages); detected {
		result.IsSafe = false
		result.Threats = append(result.Threats, models.Threat{
			Type:     models.ThreatJailbreak,
			Severity: models.SeverityCritical,
			Details:  joinMatches(jb.Matches),
		})
	}

	if esc, detected := DetectToolEscalation(ctx, &models.ChatRequest{Messages: redactedMessages}); detected {
		result.IsSafe = false
		result.Threats = append(result.Threats, models.Threat{
			Type:     models.ThreatToolEscalation,
			Severity: models.SeverityHigh,
			Details:  joinMatches(esc.Matches),
		})
	}

	if g.opts.RedactPII {
		// Rebuild a redacted prompt string for auditing and emit the redacted
		// messages so downstream handlers forward the sanitized request upstream.
		result.RedactedMessages = redactedMessages
		result.RedactedPrompt = joinContents(redactedMessages)
	} else {
		result.RedactedMessages = req.Messages
	}
	return result, nil
}

// ScanResponse scans and sanitizes a model response.
func (g *Guardian) ScanResponse(ctx context.Context, response string) (*models.SecurityScanResult, error) {
	result := &models.SecurityScanResult{IsSafe: true, Confidence: 0.9}
	if g.opts.RedactPII {
		sanitized, findings := g.outputSanitizer.Sanitize(ctx, response)
		result.RedactedResponse = sanitized
		if len(findings) > 0 {
			result.IsSafe = false
			result.Threats = append(result.Threats, models.Threat{
				Type:     models.ThreatPIIFound,
				Severity: models.SeverityMedium,
				Details:  "PII redacted from response",
			})
		}
	} else {
		result.RedactedResponse = response
	}
	return result, nil
}

// Middleware scans requests and blocks when configured thresholds are met.
func (g *Guardian) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			next.ServeHTTP(w, r)
			return
		}
		var req models.ChatRequest
		if err := decodeJSON(r.Body, &req); err != nil {
			http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
			return
		}
		res, err := g.ScanRequest(r.Context(), &req)
		if err != nil {
			http.Error(w, `{"error":"guardian_error"}`, http.StatusInternalServerError)
			return
		}
		blocked := false
		for _, t := range res.Threats {
			switch t.Type {
			case models.ThreatPromptInjection:
				blocked = blocked || g.opts.BlockInjection
			case models.ThreatJailbreak:
				blocked = blocked || g.opts.BlockJailbreak
			}
		}
		if blocked {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"request_blocked","message":"security policy violation","threats":` + threatsJSON(res.Threats) + `}`))
			return
		}
		// Pass redacted messages through via context for downstream handlers.
		if res.RedactedMessages != nil {
			req.Messages = res.RedactedMessages
		}
		ctx := context.WithValue(r.Context(), redactedReqKey, &req)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
