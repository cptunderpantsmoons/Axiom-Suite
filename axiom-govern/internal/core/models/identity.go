// Package models defines the core data structures used across the Management Harness.
package models

import "time"

// Identity represents an authenticated principal derived from an API key.
type Identity struct {
	UserID   string   `json:"user_id"`
	Email    string   `json:"email"`
	Name     string   `json:"name"`
	TeamID   string   `json:"team_id,omitempty"`
	OrgID    string   `json:"org_id,omitempty"`
	Roles    []string `json:"roles"`
	APIKeyID string   `json:"api_key_id"`
	IsAdmin  bool     `json:"is_admin"`
}

// APIKey is a stored API key record. Only the hash and prefix are persisted.
type APIKey struct {
	ID        string     `json:"id"`
	KeyHash   string     `json:"key_hash"` // SHA-256 of the raw key
	Prefix    string     `json:"prefix"`   // First 8 chars for display
	UserID    string     `json:"user_id"`
	TeamID    string     `json:"team_id,omitempty"`
	OrgID     string     `json:"org_id,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	Revoked   bool       `json:"revoked"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
	RateLimit int        `json:"rate_limit"` // Requests per minute
}
