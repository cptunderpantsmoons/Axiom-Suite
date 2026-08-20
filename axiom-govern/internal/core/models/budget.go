// Package models defines the core data structures used across the Management Harness.
package models

import "time"

// Budget defines the spending limits for a user, team, or org.
type Budget struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id,omitempty"`
	TeamID    string    `json:"team_id,omitempty"`
	OrgID     string    `json:"org_id,omitempty"`
	SoftLimit float64   `json:"soft_limit"` // Warning threshold (USD)
	HardLimit float64   `json:"hard_limit"` // Blocking threshold (USD)
	Period    string    `json:"period"`     // "monthly", "quarterly", "annual"
	ResetDate time.Time `json:"reset_date"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// BudgetUsage tracks current-period usage for a scope.
type BudgetUsage struct {
	UserID       string    `json:"user_id"`
	TeamID       string    `json:"team_id,omitempty"`
	OrgID        string    `json:"org_id,omitempty"`
	Period       string    `json:"period"`
	TotalSpend   float64   `json:"total_spend"`
	TokenCount   int64     `json:"token_count"`
	RequestCount int64     `json:"request_count"`
	UpdatedAt    time.Time `json:"updated_at"`
}
