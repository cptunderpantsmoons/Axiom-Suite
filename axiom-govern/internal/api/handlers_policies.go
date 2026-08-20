// Package api implements the Management Harness management REST API.
package api

import (
	"net/http"

	"github.com/laiw/management-harness/internal/core/models"
)

func (s *Server) handleListPolicies(w http.ResponseWriter, r *http.Request) {
	policies, err := s.policies.list(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"policies": policies})
}

func (s *Server) handleCreatePolicy(w http.ResponseWriter, r *http.Request) {
	var p models.Policy
	if err := decodeJSONBody(r, &p); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if err := s.policies.put(r.Context(), &p); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if s.deps.PolicyEngine != nil && p.Active {
		s.deps.PolicyEngine.Reload(&p)
	}
	s.auditEvent(r, "admin.policy.create", "/api/v1/policies", "success")
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleUpdatePolicy(w http.ResponseWriter, r *http.Request) {
	id := chiID(r, "id")
	existing, ok, err := s.policies.get(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "policy not found"})
		return
	}
	var p models.Policy
	if err := decodeJSONBody(r, &p); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	p.ID = id
	p.CreatedAt = existing.CreatedAt
	if err := s.policies.put(r.Context(), &p); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if s.deps.PolicyEngine != nil && p.Active {
		s.deps.PolicyEngine.Reload(&p)
	}
	s.auditEvent(r, "admin.policy.update", "/api/v1/policies/"+id, "success")
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleActivatePolicy(w http.ResponseWriter, r *http.Request) {
	id := chiID(r, "id")
	p, ok, err := s.policies.get(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "policy not found"})
		return
	}
	// Deactivate others, activate this one.
	policies, err := s.policies.list(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for _, other := range policies {
		other.Active = other.ID == id
		if err := s.policies.put(r.Context(), other); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	p.Active = true
	if s.deps.PolicyEngine != nil {
		s.deps.PolicyEngine.Reload(p)
	}
	s.auditEvent(r, "admin.policy.activate", "/api/v1/policies/"+id+"/activate", "success")
	writeJSON(w, http.StatusOK, p)
}
