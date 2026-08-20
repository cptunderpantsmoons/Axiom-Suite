// Package api implements the Management Harness management REST API.
package api

import (
	"context"
	"sync"
)

// User is a management user record.
type User struct {
	ID        string   `json:"id"`
	Email     string   `json:"email"`
	Name      string   `json:"name"`
	TeamID    string   `json:"team_id,omitempty"`
	OrgID     string   `json:"org_id,omitempty"`
	Roles     []string `json:"roles"`
	IsAdmin   bool     `json:"is_admin"`
	CreatedAt string   `json:"created_at,omitempty"`
}

// UserStore persists management users.
type UserStore interface {
	Create(ctx context.Context, u *User) error
	Get(ctx context.Context, id string) (*User, error)
	List(ctx context.Context) ([]*User, error)
	Update(ctx context.Context, u *User) error
	Delete(ctx context.Context, id string) error
}

// MemoryUserStore is an in-memory UserStore.
type MemoryUserStore struct {
	mu    sync.RWMutex
	users map[string]*User
}

// NewMemoryUserStore creates an empty in-memory user store.
func NewMemoryUserStore() *MemoryUserStore {
	return &MemoryUserStore{users: map[string]*User{}}
}

// Create adds a user.
func (s *MemoryUserStore) Create(ctx context.Context, u *User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[u.ID] = u
	return nil
}

// Get returns a user by ID.
func (s *MemoryUserStore) Get(ctx context.Context, id string) (*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	u, ok := s.users[id]
	if !ok {
		return nil, ErrNotFound
	}
	return u, nil
}

// List returns all users.
func (s *MemoryUserStore) List(ctx context.Context) ([]*User, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*User, 0, len(s.users))
	for _, u := range s.users {
		out = append(out, u)
	}
	return out, nil
}

// Update modifies a user.
func (s *MemoryUserStore) Update(ctx context.Context, u *User) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[u.ID] = u
	return nil
}

// Delete removes a user.
func (s *MemoryUserStore) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.users, id)
	return nil
}

// compile-time check that MemoryUserStore satisfies UserStore.
var _ UserStore = (*MemoryUserStore)(nil)
