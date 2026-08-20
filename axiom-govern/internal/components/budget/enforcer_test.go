package budget

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/core/models"
)

func newIdentity() *models.Identity {
	return &models.Identity{UserID: "u1", TeamID: "t1", OrgID: "o1"}
}

func TestBudgetHardLimitBlocks(t *testing.T) {
	store := NewMemoryBudgetStore()
	id := newIdentity()
	require.NoError(t, store.SetBudget(context.Background(), &models.Budget{
		UserID:    id.UserID,
		SoftLimit: 10,
		HardLimit: 10,
		Period:    "monthly",
	}))

	e := NewBudgetEnforcer(store, nil, nil)
	// Within limit.
	assert.NoError(t, e.Check(context.Background(), id, 5))
	// Exceeds hard limit.
	assert.ErrorIs(t, e.Check(context.Background(), id, 11), ErrBudgetExceeded)
}

func TestBudgetRecordAndUsage(t *testing.T) {
	store := NewMemoryBudgetStore()
	id := newIdentity()
	require.NoError(t, store.SetBudget(context.Background(), &models.Budget{
		UserID:    id.UserID,
		HardLimit: 1000,
		Period:    "monthly",
	}))
	e := NewBudgetEnforcer(store, nil, nil)
	require.NoError(t, e.RecordUsage(context.Background(), id, 12.5, 300))

	usage, err := store.GetUsage(context.Background(), id)
	require.NoError(t, err)
	assert.Equal(t, 12.5, usage.TotalSpend)
	assert.Equal(t, int64(300), usage.TokenCount)
	assert.Equal(t, int64(1), usage.RequestCount)
}

func TestNoLimitAllows(t *testing.T) {
	store := NewMemoryBudgetStore()
	e := NewBudgetEnforcer(store, nil, nil)
	assert.NoError(t, e.Check(context.Background(), newIdentity(), 9999))
}
