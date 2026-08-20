// Package budget implements per-identity budget enforcement.
package budget

import (
	"time"

	"github.com/laiw/management-harness/internal/core/models"
)

// PeriodStart returns the start of the current budgeting period in UTC.
// Unknown periods default to monthly.
func PeriodStart(now time.Time, period string) time.Time {
	y, m, _ := now.Date()
	switch period {
	case "quarterly":
		q := (int(m)-1)/3*3 + 1
		return time.Date(y, time.Month(q), 1, 0, 0, 0, 0, time.UTC)
	case "annual":
		return time.Date(y, 1, 1, 0, 0, 0, 0, time.UTC)
	default: // monthly
		return time.Date(y, m, 1, 0, 0, 0, 0, time.UTC)
	}
}

// rolloverUsage resets the counters when they belong to a previous period so
// spend does not carry across the monthly/quarterly/annual boundary.
func rolloverUsage(u *models.BudgetUsage, periodStart time.Time) {
	if u.UpdatedAt.IsZero() {
		return
	}
	if u.UpdatedAt.Before(periodStart) {
		u.TotalSpend = 0
		u.TokenCount = 0
		u.RequestCount = 0
		u.UpdatedAt = time.Now().UTC()
	}
}

// periodOf returns the usage period, defaulting to monthly when unset.
func periodOf(u *models.BudgetUsage) string {
	if u.Period == "" {
		return "monthly"
	}
	return u.Period
}
