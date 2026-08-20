// Package interfaces defines the component contracts used across the Management Harness.
package interfaces

import (
	"context"

	"github.com/laiw/management-harness/internal/core/models"
)

// KeyStore persists and retrieves API key records.
type KeyStore interface {
	GetKey(ctx context.Context, apiKey string) (*models.APIKey, error)
	GetKeyByID(ctx context.Context, keyID string) (*models.APIKey, error)
	CreateKey(ctx context.Context, key *models.APIKey) error
	RevokeKey(ctx context.Context, keyID string) error
	ListKeys(ctx context.Context, userID string) ([]*models.APIKey, error)
}

// BudgetStore persists budgets and records usage.
type BudgetStore interface {
	GetBudget(ctx context.Context, identity *models.Identity) (*models.Budget, error)
	GetUsage(ctx context.Context, identity *models.Identity) (*models.BudgetUsage, error)
	IncrementUsage(ctx context.Context, identity *models.Identity, cost float64, tokens int) error
	SetBudget(ctx context.Context, budget *models.Budget) error
	// Ping verifies the backing store is reachable (used for readiness probes).
	Ping(ctx context.Context) error
}
