package policy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/laiw/management-harness/internal/core/models"
)

// errNoActivePolicy is returned when no policy is currently marked active.
var errNoActivePolicy = errors.New("no active policy")

const (
	redisPolicyPrefix = "harness:manager:policy:"
	redisPolicyIndex  = "harness:manager:policies"
)

// RedisLoader loads the active manager policy shared through Redis.
type RedisLoader struct {
	client *redis.Client
}

func NewRedisLoader(client *redis.Client) *RedisLoader {
	return &RedisLoader{client: client}
}

func (l *RedisLoader) Load() (*models.Policy, error) {
	ids, err := l.client.SMembers(context.Background(), redisPolicyIndex).Result()
	if err != nil {
		return nil, fmt.Errorf("list policies: %w", err)
	}
	for _, id := range ids {
		data, err := l.client.Get(context.Background(), redisPolicyPrefix+id).Result()
		if err != nil {
			if err == redis.Nil {
				continue
			}
			return nil, fmt.Errorf("get policy: %w", err)
		}
		var p models.Policy
		if err := json.Unmarshal([]byte(data), &p); err != nil {
			return nil, fmt.Errorf("decode policy: %w", err)
		}
		if p.Active {
			return &p, nil
		}
	}
	return nil, errNoActivePolicy
}

// Watch polls Redis for changes and reloads the active policy when its
// serialized signature changes. A missing active policy clears the engine.
func (l *RedisLoader) Watch(ctx context.Context, onChange func(*models.Policy)) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	var last string
	for {
		select {
		case <-ticker.C:
			p, err := l.Load()
			if err != nil {
				if errors.Is(err, errNoActivePolicy) && last != "" {
					last = ""
					onChange(&models.Policy{})
				}
				continue
			}
			data, _ := json.Marshal(p)
			signature := string(data)
			if signature != last {
				last = signature
				onChange(p)
			}
		case <-ctx.Done():
			return
		}
	}
}
