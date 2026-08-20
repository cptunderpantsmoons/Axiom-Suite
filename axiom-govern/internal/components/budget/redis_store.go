// Package budget implements per-identity budget enforcement.
package budget

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/laiw/management-harness/internal/core/models"
)

const (
	redisBudgetPrefix = "harness:budget:"
	redisUsagePrefix  = "harness:usage:"
)

// RedisBudgetStore is a Redis-backed BudgetStore. Budgets are cached in Redis
// with periodic refresh; usage counters are updated with atomic Lua scripts.
type RedisBudgetStore struct {
	client *redis.Client
}

// NewRedisBudgetStore constructs a Redis-backed budget store.
func NewRedisBudgetStore(client *redis.Client) *RedisBudgetStore {
	return &RedisBudgetStore{client: client}
}

func budgetRedisKey(identity *models.Identity) string {
	return redisBudgetPrefix + budgetKey(identity)
}

func usageRedisKey(identity *models.Identity) string {
	return redisUsagePrefix + budgetKey(identity)
}

// GetBudget fetches the budget, falling back to a zero-value when unset.
func (s *RedisBudgetStore) GetBudget(ctx context.Context, identity *models.Identity) (*models.Budget, error) {
	b, err := s.client.HGetAll(ctx, budgetRedisKey(identity)).Result()
	if err != nil && err != redis.Nil {
		return nil, fmt.Errorf("redis get budget: %w", err)
	}
	if len(b) == 0 {
		return &models.Budget{ID: budgetKey(identity), UserID: identity.UserID, TeamID: identity.TeamID, OrgID: identity.OrgID, Period: "monthly"}, nil
	}
	hard := parseFloat(b["hard_limit"])
	soft := parseFloat(b["soft_limit"])
	return &models.Budget{
		ID:        b["id"],
		UserID:    identity.UserID,
		TeamID:    identity.TeamID,
		OrgID:     identity.OrgID,
		SoftLimit: soft,
		HardLimit: hard,
		Period:    b["period"],
	}, nil
}

// GetUsage fetches current usage counters.
func (s *RedisBudgetStore) GetUsage(ctx context.Context, identity *models.Identity) (*models.BudgetUsage, error) {
	vals, err := s.client.HMGet(ctx, usageRedisKey(identity), "total_spend", "token_count", "request_count", "updated_at").Result()
	if err != nil {
		return nil, fmt.Errorf("redis get usage: %w", err)
	}
	u := &models.BudgetUsage{UserID: identity.UserID, TeamID: identity.TeamID, OrgID: identity.OrgID, Period: "monthly"}
	if len(vals) > 0 && vals[0] != nil {
		u.TotalSpend = parseFloat(fmt.Sprint(vals[0]))
	}
	if len(vals) > 1 && vals[1] != nil {
		u.TokenCount = int64(parseFloat(fmt.Sprint(vals[1])))
	}
	if len(vals) > 2 && vals[2] != nil {
		u.RequestCount = int64(parseFloat(fmt.Sprint(vals[2])))
	}
	if len(vals) > 3 && vals[3] != nil {
		if t, perr := time.Parse(time.RFC3339, fmt.Sprint(vals[3])); perr == nil {
			u.UpdatedAt = t
		}
	}
	// Roll the budget over to the new period when the prior period has elapsed.
	if !u.UpdatedAt.IsZero() && u.UpdatedAt.Before(PeriodStart(time.Now().UTC(), periodOf(u))) {
		if err := s.resetUsage(ctx, identity); err != nil {
			return nil, err
		}
		return &models.BudgetUsage{UserID: identity.UserID, TeamID: identity.TeamID, OrgID: identity.OrgID, Period: periodOf(u)}, nil
	}
	return u, nil
}

// resetUsage zeroes the usage counters in Redis.
func (s *RedisBudgetStore) resetUsage(ctx context.Context, identity *models.Identity) error {
	script := `
redis.call('HSET', KEYS[1], 'total_spend', 0, 'token_count', 0, 'request_count', 0, 'updated_at', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`
	ttl := int64((30 * 24 * time.Hour).Seconds())
	if err := s.client.Eval(ctx, script, []string{usageRedisKey(identity)}, time.Now().UTC().Format(time.RFC3339), ttl).Err(); err != nil {
		return fmt.Errorf("redis reset usage: %w", err)
	}
	return nil
}

// IncrementUsage atomically increments the usage counters using a Lua script.
func (s *RedisBudgetStore) IncrementUsage(ctx context.Context, identity *models.Identity, cost float64, tokens int) error {
	script := `
local key = KEYS[1]
redis.call('HINCRBYFLOAT', key, 'total_spend', ARGV[1])
redis.call('HINCRBY', key, 'token_count', ARGV[2])
redis.call('HINCRBY', key, 'request_count', 1)
redis.call('HSET', key, 'updated_at', ARGV[4])
redis.call('EXPIRE', key, ARGV[3])
return 1
`
	ttl := int64((30 * 24 * time.Hour).Seconds())
	if err := s.client.Eval(ctx, script, []string{usageRedisKey(identity)}, cost, tokens, ttl, time.Now().UTC().Format(time.RFC3339)).Err(); err != nil {
		return fmt.Errorf("redis increment usage: %w", err)
	}
	return nil
}

// SetBudget stores a budget hash in Redis.
func (s *RedisBudgetStore) SetBudget(ctx context.Context, budget *models.Budget) error {
	id := budget.ID
	if id == "" {
		id = budgetKey(&models.Identity{UserID: budget.UserID, TeamID: budget.TeamID, OrgID: budget.OrgID})
	}
	budget.ID = id
	if budget.Period == "" {
		budget.Period = "monthly"
	}
	err := s.client.HSet(ctx, budgetRedisKey(&models.Identity{UserID: budget.UserID, TeamID: budget.TeamID, OrgID: budget.OrgID}), map[string]interface{}{
		"id":         id,
		"soft_limit": budget.SoftLimit,
		"hard_limit": budget.HardLimit,
		"period":     budget.Period,
	}).Err()
	if err != nil {
		return fmt.Errorf("redis set budget: %w", err)
	}
	return nil
}

// Ping verifies Redis connectivity.
func (s *RedisBudgetStore) Ping(ctx context.Context) error {
	if err := s.client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis ping: %w", err)
	}
	return nil
}

func parseFloat(s string) float64 {
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}
