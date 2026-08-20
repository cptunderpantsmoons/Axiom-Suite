// Package auth implements API key authentication for the Management Harness.
package auth

import (
	"context"
	"sync"
	"time"

	"github.com/laiw/management-harness/internal/core/models"
)

// MemoryKeyStore is an in-memory KeyStore implementation for development and tests.
type MemoryKeyStore struct {
	mu     sync.RWMutex
	byID   map[string]*models.APIKey
	byHash map[string]*models.APIKey
}

// NewMemoryKeyStore creates an empty in-memory key store.
func NewMemoryKeyStore() *MemoryKeyStore {
	return &MemoryKeyStore{
		byID:   map[string]*models.APIKey{},
		byHash: map[string]*models.APIKey{},
	}
}

// GetKey returns the key record for a raw API key.
func (s *MemoryKeyStore) GetKey(ctx context.Context, apiKey string) (*models.APIKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	hash := HashAPIKey(apiKey)
	k, ok := s.byHash[hash]
	if !ok {
		return nil, ErrKeyNotFound
	}
	return k, nil
}

// GetKeyByID returns the key record for a key ID.
func (s *MemoryKeyStore) GetKeyByID(ctx context.Context, keyID string) (*models.APIKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	k, ok := s.byID[keyID]
	if !ok {
		return nil, ErrKeyNotFound
	}
	return k, nil
}

// CreateKey stores a new key. The caller must generate the raw key and hash it.
func (s *MemoryKeyStore) CreateKey(ctx context.Context, key *models.APIKey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byID[key.ID] = key
	s.byHash[key.KeyHash] = key
	return nil
}

// RevokeKey marks a key as revoked.
func (s *MemoryKeyStore) RevokeKey(ctx context.Context, keyID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.byID[keyID]
	if !ok {
		return ErrKeyNotFound
	}
	now := time.Now().UTC()
	k.Revoked = true
	k.RevokedAt = &now
	return nil
}

// ListKeys returns all keys for a user.
func (s *MemoryKeyStore) ListKeys(ctx context.Context, userID string) ([]*models.APIKey, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*models.APIKey, 0)
	for _, k := range s.byID {
		if k.UserID == userID {
			out = append(out, k)
		}
	}
	return out, nil
}
