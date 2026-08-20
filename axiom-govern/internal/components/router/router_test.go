package router

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/components/cache"
	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
	"github.com/laiw/management-harness/internal/core/providers"
)

type fakeProvider struct {
	name   string
	cost   float64
	health error
}

func (f *fakeProvider) ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error) {
	return &models.ChatResponse{}, nil
}
func (f *fakeProvider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error) {
	return nil, nil
}
func (f *fakeProvider) Name() string                          { return f.name }
func (f *fakeProvider) HealthCheck(ctx context.Context) error { return f.health }
func (f *fakeProvider) EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error) {
	return f.cost, nil
}

func TestRouteWithPreferredUsesHealthyDefault(t *testing.T) {
	ps := map[string]interfaces.LLMProvider{
		"kilo":   &fakeProvider{name: "kilo", cost: 0.01, health: nil},
		"nvidia": &fakeProvider{name: "nvidia", cost: 0.01, health: nil},
	}
	r := NewModelRouter(providers.NewRegistry(ps), cache.NewMemoryCache())
	decision, err := r.RouteWithPreferred(context.Background(), &models.ChatRequest{Model: "x"}, "kilo")
	require.NoError(t, err)
	assert.Equal(t, "kilo", decision.Provider)
}

func TestRouteWithPreferredFallsBackWhenDefaultIsDown(t *testing.T) {
	ps := map[string]interfaces.LLMProvider{
		"kilo":   &fakeProvider{name: "kilo", cost: 0.01, health: assertErr},
		"nvidia": &fakeProvider{name: "nvidia", cost: 0.5, health: nil},
	}
	r := NewModelRouter(providers.NewRegistry(ps), cache.NewMemoryCache())
	decision, err := r.RouteWithPreferred(context.Background(), &models.ChatRequest{Model: "x"}, "kilo")
	require.NoError(t, err)
	assert.Equal(t, "nvidia", decision.Provider)
}

func TestRoutePrefersCheapestHealthy(t *testing.T) {
	ps := map[string]interfaces.LLMProvider{
		"expensive": &fakeProvider{name: "expensive", cost: 0.5, health: nil},
		"cheap":     &fakeProvider{name: "cheap", cost: 0.01, health: nil},
		"down":      &fakeProvider{name: "down", cost: 0.001, health: assertErr},
	}
	r := NewModelRouter(providers.NewRegistry(ps), cache.NewMemoryCache())
	decision, err := r.Route(context.Background(), &models.ChatRequest{Model: "x"})
	require.NoError(t, err)
	assert.Equal(t, "cheap", decision.Provider)
}

var assertErr = errHealth{}

type errHealth struct{}

func (errHealth) Error() string { return "unhealthy" }
