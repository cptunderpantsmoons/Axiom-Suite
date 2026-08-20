// Package models defines the core data structures used across the Management Harness.
package models

import "time"

// Policy is a named, versioned set of rules.
type Policy struct {
	ID          string    `json:"id"`
	Version     string    `json:"version"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Rules       []Rule    `json:"rules"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Rule is a single policy rule with a condition and action.
type Rule struct {
	ID        string                 `json:"id"`
	Priority  int                    `json:"priority"`
	Condition string                 `json:"condition"`
	Action    string                 `json:"action"`
	Message   string                 `json:"message,omitempty"`
	Params    map[string]interface{} `json:"params,omitempty"`
}
