// Package skills implements reusable, governed prompt "skills" (versioned
// prompt contracts) for the Management Harness.
package skills

import (
	"sync"

	"github.com/laiw/management-harness/internal/core/models"
)

// Registry holds the active skills keyed by name and supports lock-free readers
// via snapshot copies and atomic replacement (mirrors providers.Registry).
type Registry struct {
	mu sync.RWMutex
	m  map[string]*models.Skill
}

// NewRegistry constructs a registry seeded with the given skills.
func NewRegistry(m map[string]*models.Skill) *Registry {
	r := &Registry{}
	r.Replace(m)
	return r
}

// Snapshot returns a copy of the current skill map.
func (r *Registry) Snapshot() map[string]*models.Skill {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]*models.Skill, len(r.m))
	for k, v := range r.m {
		out[k] = v
	}
	return out
}

// Replace swaps in a new skill set.
func (r *Registry) Replace(m map[string]*models.Skill) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := make(map[string]*models.Skill, len(m))
	for k, v := range m {
		n[k] = v
	}
	r.m = n
}

// Len returns the number of registered skills.
func (r *Registry) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.m)
}