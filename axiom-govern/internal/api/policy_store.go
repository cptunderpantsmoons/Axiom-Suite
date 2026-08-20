// Package api implements the Management Harness management REST API.
package api

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/laiw/management-harness/internal/core/models"
)

// policyStoreBackend persists named policies for the manager API.
type policyStoreBackend interface {
	list(context.Context) ([]*models.Policy, error)
	get(context.Context, string) (*models.Policy, bool, error)
	put(context.Context, *models.Policy) error
	delete(context.Context, string) error
}

// policyStore is the in-memory policy implementation used when Redis is
// disabled (development/tests).
type policyStore struct {
	mu       sync.RWMutex
	policies map[string]*models.Policy
}

func newPolicyStore() *policyStore {
	return &policyStore{policies: map[string]*models.Policy{}}
}

func (s *policyStore) list(_ context.Context) ([]*models.Policy, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*models.Policy, 0, len(s.policies))
	for _, p := range s.policies {
		copy := *p
		out = append(out, &copy)
	}
	return out, nil
}

func (s *policyStore) get(_ context.Context, id string) (*models.Policy, bool, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	p, ok := s.policies[id]
	if !ok {
		return nil, false, nil
	}
	copy := *p
	return &copy, true, nil
}

func (s *policyStore) put(_ context.Context, p *models.Policy) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	if p.Version == "" {
		p.Version = "1.0.0"
	}
	if p.CreatedAt.IsZero() {
		p.CreatedAt = time.Now().UTC()
	}
	p.UpdatedAt = time.Now().UTC()
	copy := *p
	s.policies[p.ID] = &copy
	return nil
}

func (s *policyStore) delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.policies, id)
	return nil
}
