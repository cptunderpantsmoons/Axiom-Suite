// Package budget implements per-identity budget enforcement.
package budget

import (
	"context"
	"sync"
	"time"

	"github.com/laiw/management-harness/internal/core/models"
)

// MemoryBudgetStore is an in-memory BudgetStore for development and tests.
type MemoryBudgetStore struct {
	mu      sync.RWMutex
	budgets map[string]*models.Budget
	usage   map[string]*models.BudgetUsage
}

// NewMemoryBudgetStore creates an empty in-memory budget store.
func NewMemoryBudgetStore() *MemoryBudgetStore {
	return &MemoryBudgetStore{
		budgets: map[string]*models.Budget{},
		usage:   map[string]*models.BudgetUsage{},
	}
}

func budgetKey(identity *models.Identity) string {
	switch {
	case identity.UserID != "":
		return "user:" + identity.UserID
	case identity.TeamID != "":
		return "team:" + identity.TeamID
	case identity.OrgID != "":
		return "org:" + identity.OrgID
	default:
		return "global"
	}
}

// GetBudget returns the budget for an identity, creating a zero-value if absent.
func (s *MemoryBudgetStore) GetBudget(ctx context.Context, identity *models.Identity) (*models.Budget, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	k := budgetKey(identity)
	if b, ok := s.budgets[k]; ok {
		return b, nil
	}
	return &models.Budget{ID: k, UserID: identity.UserID, TeamID: identity.TeamID, OrgID: identity.OrgID, Period: "monthly"}, nil
}

// GetUsage returns the current usage for an identity.
func (s *MemoryBudgetStore) GetUsage(ctx context.Context, identity *models.Identity) (*models.BudgetUsage, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	k := budgetKey(identity)
	if u, ok := s.usage[k]; ok {
		rolloverUsage(u, PeriodStart(time.Now().UTC(), periodOf(u)))
		return u, nil
	}
	return &models.BudgetUsage{UserID: identity.UserID, TeamID: identity.TeamID, OrgID: identity.OrgID, Period: "monthly"}, nil
}

// IncrementUsage atomically increments usage counters.
func (s *MemoryBudgetStore) IncrementUsage(ctx context.Context, identity *models.Identity, cost float64, tokens int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := budgetKey(identity)
	u := s.usage[k]
	if u == nil {
		u = &models.BudgetUsage{UserID: identity.UserID, TeamID: identity.TeamID, OrgID: identity.OrgID, Period: "monthly"}
		s.usage[k] = u
	}
	rolloverUsage(u, PeriodStart(time.Now().UTC(), periodOf(u)))
	u.TotalSpend += cost
	u.TokenCount += int64(tokens)
	u.RequestCount++
	u.UpdatedAt = time.Now().UTC()
	return nil
}

// SetBudget stores a budget for an identity.
func (s *MemoryBudgetStore) SetBudget(ctx context.Context, budget *models.Budget) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := budget.ID
	if k == "" {
		k = budgetKey(&models.Identity{UserID: budget.UserID, TeamID: budget.TeamID, OrgID: budget.OrgID})
	}
	budget.ID = k
	budget.UpdatedAt = time.Now().UTC()
	if budget.CreatedAt.IsZero() {
		budget.CreatedAt = budget.UpdatedAt
	}
	s.budgets[k] = budget
	return nil
}

// Ping is a no-op for the in-memory store.
func (s *MemoryBudgetStore) Ping(ctx context.Context) error { return nil }
