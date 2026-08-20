// Package api implements the Management Harness management REST API.
package api

import (
	"net/http"

	"github.com/laiw/management-harness/internal/api/middleware"
	"github.com/laiw/management-harness/internal/core/models"
)

// auditEvent records a management (admin) action on the shared, hash-chained
// audit logger so it is surfaced by the /audit endpoints and the overview.
// It is a no-op if the audit logger is not configured (never in normal
// bootstrapped operation, but defensive for tests/embedding).
func (s *Server) auditEvent(r *http.Request, action, resource, outcome string) {
	if s.deps == nil || s.deps.Audit == nil {
		return
	}
	userID := ""
	if identity, ok := middleware.IdentityFromContext(r.Context()); ok && identity != nil {
		userID = identity.UserID
	}
	_ = s.deps.Audit.Log(r.Context(), &models.AuditEvent{
		UserID:    userID,
		Action:    action,
		Resource:  resource,
		Outcome:   outcome,
		IPAddress: r.RemoteAddr,
		UserAgent: r.UserAgent(),
	})
}

// auditEvents returns a snapshot of the audit trail, or an empty slice when the
// audit logger is not available (never in normal bootstrap, but defensive for
// tests/embedding).
func (s *Server) auditEvents() []*models.AuditEvent {
	if s.deps == nil || s.deps.Audit == nil {
		return []*models.AuditEvent{}
	}
	if events := s.deps.Audit.Events(); events != nil {
		return events
	}
	return []*models.AuditEvent{}
}

// auditVerified reports whether the hash chain is intact; false when the audit
// logger is unavailable.
func (s *Server) auditVerified() bool {
	if s.deps == nil || s.deps.Audit == nil {
		return false
	}
	ok, _ := s.deps.Audit.VerifyChain()
	return ok
}