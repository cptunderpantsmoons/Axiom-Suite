package api

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/laiw/management-harness/internal/core/models"
)

const (
	redisUserPrefix   = "harness:manager:user:"
	redisUserIndex    = "harness:manager:users"
	redisPolicyPrefix = "harness:manager:policy:"
	redisPolicyIndex  = "harness:manager:policies"
)

// RedisUserStore persists manager users in Redis. User records are JSON values
// indexed by a Redis set so listing does not require an unbounded KEYS scan.
type RedisUserStore struct {
	client *redis.Client
}

func NewRedisUserStore(client *redis.Client) *RedisUserStore {
	return &RedisUserStore{client: client}
}

func (s *RedisUserStore) Create(ctx context.Context, user *User) error {
	if user.ID == "" {
		user.ID = uuid.NewString()
	}
	data, err := json.Marshal(user)
	if err != nil {
		return fmt.Errorf("encode user: %w", err)
	}
	pipe := s.client.TxPipeline()
	pipe.Set(ctx, redisUserPrefix+user.ID, data, 0)
	pipe.SAdd(ctx, redisUserIndex, user.ID)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (s *RedisUserStore) Get(ctx context.Context, id string) (*User, error) {
	data, err := s.client.Get(ctx, redisUserPrefix+id).Result()
	if err == redis.Nil {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	var user User
	if err := json.Unmarshal([]byte(data), &user); err != nil {
		return nil, fmt.Errorf("decode user: %w", err)
	}
	return &user, nil
}

func (s *RedisUserStore) List(ctx context.Context) ([]*User, error) {
	ids, err := s.client.SMembers(ctx, redisUserIndex).Result()
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	users := make([]*User, 0, len(ids))
	for _, id := range ids {
		user, err := s.Get(ctx, id)
		if err == nil {
			users = append(users, user)
			continue
		}
		if err != ErrNotFound {
			return nil, err
		}
	}
	return users, nil
}

func (s *RedisUserStore) Update(ctx context.Context, user *User) error {
	if _, err := s.Get(ctx, user.ID); err != nil {
		return err
	}
	data, err := json.Marshal(user)
	if err != nil {
		return fmt.Errorf("encode user: %w", err)
	}
	if err := s.client.Set(ctx, redisUserPrefix+user.ID, data, 0).Err(); err != nil {
		return fmt.Errorf("update user: %w", err)
	}
	return nil
}

func (s *RedisUserStore) Delete(ctx context.Context, id string) error {
	pipe := s.client.TxPipeline()
	pipe.Del(ctx, redisUserPrefix+id)
	pipe.SRem(ctx, redisUserIndex, id)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	return nil
}

var _ UserStore = (*RedisUserStore)(nil)

type redisPolicyStore struct {
	client *redis.Client
}

func newRedisPolicyStore(client *redis.Client) *redisPolicyStore {
	return &redisPolicyStore{client: client}
}

func (s *redisPolicyStore) list(ctx context.Context) ([]*models.Policy, error) {
	ids, err := s.client.SMembers(ctx, redisPolicyIndex).Result()
	if err != nil {
		return nil, fmt.Errorf("list policies: %w", err)
	}
	policies := make([]*models.Policy, 0, len(ids))
	for _, id := range ids {
		policy, ok, err := s.get(ctx, id)
		if err != nil {
			return nil, err
		}
		if ok {
			policies = append(policies, policy)
		}
	}
	return policies, nil
}

func (s *redisPolicyStore) get(ctx context.Context, id string) (*models.Policy, bool, error) {
	data, err := s.client.Get(ctx, redisPolicyPrefix+id).Result()
	if err == redis.Nil {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get policy: %w", err)
	}
	var policy models.Policy
	if err := json.Unmarshal([]byte(data), &policy); err != nil {
		return nil, false, fmt.Errorf("decode policy: %w", err)
	}
	return &policy, true, nil
}

func (s *redisPolicyStore) put(ctx context.Context, policy *models.Policy) error {
	data, err := json.Marshal(policy)
	if err != nil {
		return fmt.Errorf("encode policy: %w", err)
	}
	pipe := s.client.TxPipeline()
	pipe.Set(ctx, redisPolicyPrefix+policy.ID, data, 0)
	pipe.SAdd(ctx, redisPolicyIndex, policy.ID)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("save policy: %w", err)
	}
	return nil
}

func (s *redisPolicyStore) delete(ctx context.Context, id string) error {
	pipe := s.client.TxPipeline()
	pipe.Del(ctx, redisPolicyPrefix+id)
	pipe.SRem(ctx, redisPolicyIndex, id)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("delete policy: %w", err)
	}
	return nil
}

var _ policyStoreBackend = (*redisPolicyStore)(nil)
