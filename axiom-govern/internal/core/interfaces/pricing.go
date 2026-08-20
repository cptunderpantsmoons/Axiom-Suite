// Package interfaces defines the component contracts used across the Management Harness.
package interfaces

import (
	"github.com/laiw/management-harness/internal/core/models"
)

// Pricing converts token usage into a USD cost. It is the source of truth for
// the per-identity/per-team cost metric (harness_budget_cost_total_usd) and for
// any future cost-based routing or budget-estimate reconciliation.
type Pricing interface {
	Price(provider, model string, usage models.Usage) (float64, error)
}