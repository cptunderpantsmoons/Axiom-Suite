// Package cache implements response caching for the Management Harness.
package cache

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

const maxMemoryEntries = 10_000

// MemoryCache is an in-memory implementation of interfaces.Cache.
type MemoryCache struct {
	mu    sync.RWMutex
	items map[string]cacheItem
}

type cacheItem struct {
	value   []byte
	expires time.Time
	touched time.Time
}

// NewMemoryCache constructs an empty in-memory cache.
func NewMemoryCache() *MemoryCache {
	return &MemoryCache{items: map[string]cacheItem{}}
}

// Get retrieves a value, returning an error if missing or expired. Returned
// bytes are copied so callers cannot mutate cached state without the lock.
func (c *MemoryCache) Get(ctx context.Context, key string) ([]byte, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	it, ok := c.items[key]
	if !ok || expired(it, time.Now()) {
		if ok {
			delete(c.items, key)
		}
		return nil, interfaces.ErrCacheMiss
	}
	it.touched = time.Now()
	c.items[key] = it
	return append([]byte(nil), it.value...), nil
}

// Set stores a value with the given TTL and bounds the number of entries.
func (c *MemoryCache) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if _, exists := c.items[key]; !exists && len(c.items) >= maxMemoryEntries {
		c.evictOldest(now)
	}
	it := cacheItem{value: append([]byte(nil), value...), touched: now}
	if ttl > 0 {
		it.expires = now.Add(ttl)
	}
	c.items[key] = it
	return nil
}

// Delete removes a value.
func (c *MemoryCache) Delete(ctx context.Context, key string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.items, key)
	return nil
}

// Exists reports whether a key is present and unexpired.
func (c *MemoryCache) Exists(ctx context.Context, key string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	it, ok := c.items[key]
	if !ok || expired(it, time.Now()) {
		if ok {
			delete(c.items, key)
		}
		return false, nil
	}
	return true, nil
}

func expired(it cacheItem, now time.Time) bool {
	return !it.expires.IsZero() && !it.expires.After(now)
}

func (c *MemoryCache) evictOldest(now time.Time) {
	var oldestKey string
	var oldest time.Time
	for key, item := range c.items {
		if expired(item, now) {
			delete(c.items, key)
			continue
		}
		if oldestKey == "" || item.touched.Before(oldest) {
			oldestKey, oldest = key, item.touched
		}
	}
	if oldestKey != "" {
		delete(c.items, oldestKey)
	}
}

// CachedResponse is a stored response entry.
type CachedResponse struct {
	Response *models.ChatResponse `json:"response"`
}

// ResponseCache caches chat responses using exact matching.
type ResponseCache struct {
	store      interfaces.Cache
	similarity float64
	defaultTTL time.Duration
}

// NewResponseCache constructs a ResponseCache.
func NewResponseCache(store interfaces.Cache, similarity float64) *ResponseCache {
	if similarity <= 0 {
		similarity = 0.99
	}
	return &ResponseCache{store: store, similarity: similarity, defaultTTL: 10 * time.Minute}
}

func (c *ResponseCache) exactKey(namespace string, req *models.ChatRequest) string {
	b, _ := json.Marshal(req)
	h := sha256.Sum256(append([]byte(namespace+":"), b...))
	return fmt.Sprintf("resp:%x", h[:])
}

// Get returns a cached response if present in the default namespace.
func (c *ResponseCache) Get(ctx context.Context, req *models.ChatRequest) (*CachedResponse, error) {
	return c.GetFor(ctx, "", req)
}

// GetFor returns a cached response scoped to an identity/provider namespace.
func (c *ResponseCache) GetFor(ctx context.Context, namespace string, req *models.ChatRequest) (*CachedResponse, error) {
	key := c.exactKey(namespace, req)
	data, err := c.store.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	var cr CachedResponse
	if err := json.Unmarshal(data, &cr); err != nil {
		return nil, err
	}
	return &cr, nil
}

// Set stores a response in the default namespace.
func (c *ResponseCache) Set(ctx context.Context, req *models.ChatRequest, resp *models.ChatResponse) error {
	return c.SetFor(ctx, "", req, resp)
}

// SetFor stores a response scoped to an identity/provider namespace.
func (c *ResponseCache) SetFor(ctx context.Context, namespace string, req *models.ChatRequest, resp *models.ChatResponse) error {
	key := c.exactKey(namespace, req)
	cr := CachedResponse{Response: resp}
	data, err := json.Marshal(cr)
	if err != nil {
		return err
	}
	return c.store.Set(ctx, key, data, c.defaultTTL)
}
