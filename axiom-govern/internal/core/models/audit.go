// Package models defines the core data structures used across the Management Harness.
package models

import (
	"encoding/json"
	"time"
)

// AuditEvent is an immutable, hash-chained audit record.
type AuditEvent struct {
	ID           string          `json:"id"`
	Timestamp    time.Time       `json:"timestamp"`
	Hash         string          `json:"hash"` // Hash-chain for immutability
	PreviousHash string          `json:"previous_hash"`
	UserID       string          `json:"user_id"`
	TeamID       string          `json:"team_id,omitempty"`
	APIKeyID     string          `json:"api_key_id"`
	RequestID    string          `json:"request_id"`
	Action       string          `json:"action"`   // "proxy.request", "auth.login", "budget.exceeded"
	Resource     string          `json:"resource"` // "/v1/chat/completions"
	Outcome      string          `json:"outcome"`  // "success", "failure", "blocked"
	Details      json.RawMessage `json:"details"`
	IPAddress    string          `json:"ip_address,omitempty"`
	UserAgent    string          `json:"user_agent,omitempty"`
}
