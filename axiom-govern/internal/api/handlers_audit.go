// Package api implements the Management Harness management REST API.
package api

import (
	"net/http"
)

func (s *Server) handleListAuditEvents(w http.ResponseWriter, r *http.Request) {
	limit := 100
	events := s.auditEvents()
	if len(events) > limit {
		events = events[len(events)-limit:]
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"events": events})
}

func (s *Server) handleExportAudit(w http.ResponseWriter, r *http.Request) {
	events := s.auditEvents()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = encodeJSON(w, map[string]interface{}{"events": events})
}

func (s *Server) handleVerifyAudit(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"verified": s.auditVerified()})
}