// Package api implements the Management Harness management REST API.
package api

import (
	"net/http"
	"sort"

	"github.com/laiw/management-harness/internal/core/models"
)

// handleCost returns per-operator budget & usage plus totals and optimizer
// savings, for the dashboard's Cost management view.
func (s *Server) handleCost(w http.ResponseWriter, r *http.Request) {
	if s.deps == nil || s.deps.BudgetStore == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"users": []map[string]interface{}{}})
		return
	}
	users, err := s.users.List(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	var totalSpend float64
	var totalTokens int64
	over := 0
	rows := make([]map[string]interface{}, 0, len(users))
	for _, u := range users {
		identity := &models.Identity{UserID: u.ID, TeamID: u.TeamID, OrgID: u.OrgID}
		budget, _ := s.deps.BudgetStore.GetBudget(r.Context(), identity)
		usage, _ := s.deps.BudgetStore.GetUsage(r.Context(), identity)
		totalSpend += usage.TotalSpend
		totalTokens += usage.TokenCount
		overBudget := budget.HardLimit > 0 && usage.TotalSpend >= budget.HardLimit
		if overBudget {
			over++
		}
		rows = append(rows, map[string]interface{}{
			"user_id":    u.ID,
			"email":      u.Email,
			"team_id":    u.TeamID,
			"soft_limit": budget.SoftLimit,
			"hard_limit": budget.HardLimit,
			"spend":      usage.TotalSpend,
			"tokens":     usage.TokenCount,
			"requests":   usage.RequestCount,
			"over":       overBudget,
		})
	}
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i]["spend"].(float64) > rows[j]["spend"].(float64)
	})

	savingsTokens := 0
	if s.deps.Savings != nil {
		savingsTokens = s.deps.Savings.Total()
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"users":                 rows,
		"total_spend":           totalSpend,
		"total_tokens":          totalTokens,
		"users_over_budget":     over,
		"optimizer_tokens_saved": savingsTokens,
	})
}