// Package interfaces defines the component contracts used across the Management Harness.
package interfaces

import (
	"context"
	"time"

	"github.com/laiw/management-harness/internal/core/models"
)

// LLMProvider abstracts an upstream LLM provider (OpenAI, Anthropic, ...).
type LLMProvider interface {
	ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error)
	ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error)
	Name() string
	HealthCheck(ctx context.Context) error
	EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error)
}

// Cache is a generic byte-oriented cache abstraction.
type Cache interface {
	Get(ctx context.Context, key string) ([]byte, error)
	Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
	Delete(ctx context.Context, key string) error
	Exists(ctx context.Context, key string) (bool, error)
}
