// Package savings records prompt-optimisation token savings so they can be
// surfaced in the management dashboard. A memory store is used when Redis is
// disabled; a Redis-backed store shares savings across the proxy and manager.
package savings

import (
	"context"
	"strconv"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Store records accumulated optimizer token savings.
type Store interface {
	// AddSaved records tokens saved for a skill ("" = global).
	AddSaved(skill string, tokens int)
	// Total returns total tokens saved across all skills.
	Total() int
	// BySkill returns tokens saved per skill.
	BySkill() map[string]int
}

// MemoryStore is an in-process savings store (no sharing across processes).
type MemoryStore struct {
	mu     sync.Mutex
	total  int
	bySkill map[string]int
}

// NewMemory constructs an in-memory savings store.
func NewMemory() *MemoryStore {
	return &MemoryStore{bySkill: map[string]int{}}
}

// AddSaved records tokens saved for a skill.
func (m *MemoryStore) AddSaved(skill string, tokens int) {
	if tokens <= 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.total += tokens
	m.bySkill[skill] += tokens
}

// Total returns total tokens saved.
func (m *MemoryStore) Total() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.total
}

// BySkill returns a copy of per-skill savings.
func (m *MemoryStore) BySkill() map[string]int {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]int, len(m.bySkill))
	for k, v := range m.bySkill {
		out[k] = v
	}
	return out
}

// RedisStore is a Redis-backed savings store shared across processes.
type RedisStore struct {
	client *redis.Client
	key    string
}

// NewRedis constructs a Redis-backed savings store.
func NewRedis(client *redis.Client, key string) *RedisStore {
	return &RedisStore{client: client, key: key}
}

// AddSaved records tokens saved for a skill in a hash counter.
func (r *RedisStore) AddSaved(skill string, tokens int) {
	if tokens <= 0 {
		return
	}
	ctx := context.Background()
	r.client.HIncrBy(ctx, r.key, "all", int64(tokens))
	r.client.HIncrBy(ctx, r.key, skill, int64(tokens))
}

// Total returns total tokens saved (sum of per-skill counters except "all").
func (r *RedisStore) Total() int {
	ctx := context.Background()
	m, _ := r.client.HGetAll(ctx, r.key).Result()
	return int(sumExceptAll(m))
}

// BySkill returns tokens saved per skill.
func (r *RedisStore) BySkill() map[string]int {
	ctx := context.Background()
	m, _ := r.client.HGetAll(ctx, r.key).Result()
	out := map[string]int{}
	for k, v := range m {
		if k == "all" {
			continue
		}
		if n, err := strconv.Atoi(v); err == nil {
			out[k] = n
		}
	}
	return out
}

func sumExceptAll(m map[string]string) int64 {
	var total int64
	for k, v := range m {
		if k == "all" {
			continue
		}
		if n, err := strconv.Atoi(v); err == nil {
			total += int64(n)
		}
	}
	return total
}