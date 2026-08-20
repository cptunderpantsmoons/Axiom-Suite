// Package api implements the Management Harness management REST API.
package api

import (
	"net/http"

	"github.com/laiw/management-harness/internal/core/models"
)

func (s *Server) handleGetBudget(w http.ResponseWriter, r *http.Request) {
	id := chiID(r, "id")
	identity := &models.Identity{UserID: id}
	budget, err := s.deps.BudgetStore.GetBudget(r.Context(), identity)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	usage, err := s.deps.BudgetStore.GetUsage(r.Context(), identity)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"budget": budget, "usage": usage})
}

func (s *Server) handleSetBudget(w http.ResponseWriter, r *http.Request) {
	id := chiID(r, "id")
	var budget models.Budget
	if err := decodeJSONBody(r, &budget); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	budget.UserID = id
	budget.ID = ""
	if err := s.deps.BudgetStore.SetBudget(r.Context(), &budget); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.auditEvent(r, "admin.budget.set", "/api/v1/users/"+id+"/budget", "success")
	writeJSON(w, http.StatusOK, budget)
}

func (s *Server) handleGetUsage(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("user_id")
	identity := &models.Identity{UserID: id}
	usage, err := s.deps.BudgetStore.GetUsage(r.Context(), identity)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, usage)
}
