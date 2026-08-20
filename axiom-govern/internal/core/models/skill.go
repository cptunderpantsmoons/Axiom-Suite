// Package models defines the core data structures used across the Management Harness.
package models

import "time"

// Skill is a named, versioned, reusable prompt contract stored and enforced at
// the gateway. It bundles a system prompt, a templated body with typed {{slots}},
// declared parameters, and permissions.
type Skill struct {
	Name         string       `json:"name"`
	Version      string       `json:"version"`
	Description  string       `json:"description,omitempty"`
	SystemPrompt string       `json:"system_prompt"`
	Template     string       `json:"template"`
	Parameters   []SkillParam `json:"parameters,omitempty"`
	Owner        string       `json:"owner,omitempty"` // team or org id
	Public       bool         `json:"public"`
	Teams        []string     `json:"teams,omitempty"`
	// Optimize opts this skill into skill-scoped prompt optimisation.
	Optimize   bool      `json:"optimize"`
	Deprecated bool      `json:"deprecated,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// SkillParam declares a slot in a skill template.
type SkillParam struct {
	Name        string `json:"name"`
	Type        string `json:"type,omitempty"` // string | int | bool | enum
	Required    bool   `json:"required"`
	Default     any    `json:"default,omitempty"`
	Enum        []any  `json:"enum,omitempty"`
	MaxLength   int    `json:"max_length,omitempty"`
	Description string `json:"description,omitempty"`
}