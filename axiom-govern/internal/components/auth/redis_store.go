// Package auth implements API key authentication for the Management Harness.
package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/laiw/management-harness/internal/core/models"
)

const (
	redisKeyIDPrefix   = "harness:key:id:"
	redisKeyHashPrefix = "harness:key:hash:"
	redisKeyUserPrefix = "harness:key:user:"
)

// RedisKeyStore is a Redis-backed KeyStore. It stores the canonical key record
// (keyed by ID), a hash→ID reverse index for fast raw-key lookups, and a
// user→keyIDs set for listing. Unlike the in-memory store, it is shared across
// processes, so keys minted by the manager are visible to the proxy when both
// use Redis.
type RedisKeyStore struct {
	client *redis.Client
}

// NewRedisKeyStore constructs a Redis-backed key store.
func NewRedisKeyStore(client *redis.Client) *RedisKeyStore {
	return &RedisKeyStore{client: client}
}

// GetKey resolves a raw API key to its stored record via the hash index.
func (s *RedisKeyStore) GetKey(ctx context.Context, apiKey string) (*models.APIKey, error) {
	hash := HashAPIKey(apiKey)
	keyID, err := s.client.Get(ctx, redisKeyHashPrefix+hash).Result()
	if err == redis.Nil {
		return nil, ErrKeyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("redis get key: %w", err)
	}
	return s.GetKeyByID(ctx, keyID)
}

// GetKeyByID returns the key record for a key ID.
func (s *RedisKeyStore) GetKeyByID(ctx context.Context, keyID string) (*models.APIKey, error) {
	data, err := s.client.Get(ctx, redisKeyIDPrefix+keyID).Result()
	if err == redis.Nil {
		return nil, ErrKeyNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("redis get key by id: %w", err)
	}
	var key models.APIKey
	if err := json.Unmarshal([]byte(data), &key); err != nil {
		return nil, fmt.Errorf("redis decode key: %w", err)
	}
	return &key, nil
}

// CreateKey stores a new key and its reverse indexes in a single transaction.
func (s *RedisKeyStore) CreateKey(ctx context.Context, key *models.APIKey) error {
	data, err := json.Marshal(key)
	if err != nil {
		return fmt.Errorf("redis encode key: %w", err)
	}
	pipe := s.client.TxPipeline()
	pipe.Set(ctx, redisKeyIDPrefix+key.ID, data, 0)
	pipe.Set(ctx, redisKeyHashPrefix+key.KeyHash, key.ID, 0)
	pipe.SAdd(ctx, redisKeyUserPrefix+key.UserID, key.ID)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("redis create key: %w", err)
	}
	return nil
}

// RevokeKey marks a key as revoked.
func (s *RedisKeyStore) RevokeKey(ctx context.Context, keyID string) error {
	key, err := s.GetKeyByID(ctx, keyID)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	key.Revoked = true
	key.RevokedAt = &now
	data, err := json.Marshal(key)
	if err != nil {
		return fmt.Errorf("redis encode key: %w", err)
	}
	if err := s.client.Set(ctx, redisKeyIDPrefix+keyID, data, 0).Err(); err != nil {
		return fmt.Errorf("redis revoke key: %w", err)
	}
	return nil
}

// ListKeys returns all keys for a user (best-effort: skips orphans).
func (s *RedisKeyStore) ListKeys(ctx context.Context, userID string) ([]*models.APIKey, error) {
	ids, err := s.client.SMembers(ctx, redisKeyUserPrefix+userID).Result()
	if err != nil {
		return nil, fmt.Errorf("redis list keys: %w", err)
	}
	out := make([]*models.APIKey, 0, len(ids))
	for _, id := range ids {
		if key, err := s.GetKeyByID(ctx, id); err == nil {
			out = append(out, key)
		}
	}
	return out, nil
}