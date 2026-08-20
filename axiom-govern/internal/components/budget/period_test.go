package budget

import (
	"context"
	"testing"
	"time"

	"github.com/laiw/management-harness/internal/core/models"
)

func TestUsageRollsOverNewMonth(t *testing.T) {
	store := NewMemoryBudgetStore()
	id := &models.Identity{UserID: "u1"}

	// Simulate prior-period usage dated last month.
	lastMonth := time.Now().UTC().AddDate(0, -1, 0)
	store.usage[budgetKey(id)] = &models.BudgetUsage{
		UserID:       "u1",
		Period:       "monthly",
		TotalSpend:   100,
		TokenCount:   1000,
		RequestCount: 10,
		UpdatedAt:    lastMonth,
	}

	u, err := store.GetUsage(context.Background(), id)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if u.TotalSpend != 0 || u.TokenCount != 0 || u.RequestCount != 0 {
		t.Fatalf("expected counters to roll over, got %+v", u)
	}
}

func TestUsageRetainedSameMonth(t *testing.T) {
	store := NewMemoryBudgetStore()
	id := &models.Identity{UserID: "u1"}
	_ = store.IncrementUsage(context.Background(), id, 5, 50)
	u, _ := store.GetUsage(context.Background(), id)
	if u.TotalSpend != 5 || u.TokenCount != 50 {
		t.Fatalf("expected usage retained in period, got %+v", u)
	}
}

func TestPeriodStart(t *testing.T) {
	now := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC)
	if got := PeriodStart(now, "monthly"); got.Day() != 1 || got.Month() != 3 {
		t.Fatalf("monthly period start wrong: %v", got)
	}
	if got := PeriodStart(now, "quarterly"); got.Month() != 1 {
		t.Fatalf("quarterly period start wrong: %v", got)
	}
	if got := PeriodStart(now, "annual"); got.Month() != 1 || got.Day() != 1 {
		t.Fatalf("annual period start wrong: %v", got)
	}
}
