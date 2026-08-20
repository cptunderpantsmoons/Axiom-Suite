// Package providers provides a concurrency-safe provider registry so a running
// gateway can hot-reload its provider set without data races.
package providers

import (
	"sync"

	"github.com/laiw/management-harness/internal/core/interfaces"
)

// Registry holds the active provider set and supports lock-free readers via
// snapshot copies and atomic replacement by a reload worker.
type Registry struct {
	mu sync.RWMutex
	m  map[string]interfaces.LLMProvider
}

// NewRegistry constructs a registry seeded with the given providers.
func NewRegistry(m map[string]interfaces.LLMProvider) *Registry {
	r := &Registry{}
	r.Replace(m)
	return r
}

// Snapshot returns a copy of the current provider map.
func (r *Registry) Snapshot() map[string]interfaces.LLMProvider {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]interfaces.LLMProvider, len(r.m))
	for k, v := range r.m {
		out[k] = v
	}
	return out
}

// Replace swaps in a new provider set.
func (r *Registry) Replace(m map[string]interfaces.LLMProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := make(map[string]interfaces.LLMProvider, len(m))
	for k, v := range m {
		n[k] = v
	}
	r.m = n
}

// Len returns the number of registered providers.
func (r *Registry) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.m)
}