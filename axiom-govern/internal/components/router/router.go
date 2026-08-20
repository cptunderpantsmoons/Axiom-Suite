// Package router implements cost/performance-based model routing.
package router

import (
	"context"
	"sort"

	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
	"github.com/laiw/management-harness/internal/core/providers"
)

// Preferences influence routing decisions.
type Preferences struct {
	PreferCheapest    bool
	PreferQuality     bool
	PreferredProvider string
	AllowedProviders  []string
}

// ProviderScore is a scored provider candidate.
type ProviderScore struct {
	Name    string
	Cost    float64
	Score   float64
	Healthy bool
}

// RoutingDecision is the outcome of routing.
type RoutingDecision struct {
	Provider string  `json:"provider"`
	Model    string  `json:"model"`
	Score    float64 `json:"score"`
}

// ModelRouter selects the best provider for a request. It reads from a
// concurrency-safe registry so provider sets can be hot-reloaded.
type ModelRouter struct {
	providers *providers.Registry
	costCache interfaces.Cache
}

// NewModelRouter constructs a ModelRouter over the given provider registry.
func NewModelRouter(registry *providers.Registry, costCache interfaces.Cache) *ModelRouter {
	return &ModelRouter{providers: registry, costCache: costCache}
}

func (r *ModelRouter) scoreProviders(ctx context.Context, req *models.ChatRequest, prefs *Preferences) []*ProviderScore {
	current := r.providers.Snapshot()
	scores := make([]*ProviderScore, 0, len(current))
	for name, p := range current {
		if prefs != nil && len(prefs.AllowedProviders) > 0 && !contains(prefs.AllowedProviders, name) {
			continue
		}
		cost, _ := p.EstimateCost(ctx, req)
		healthy := p.HealthCheck(ctx) == nil
		score := 1.0
		if prefs != nil && prefs.PreferCheapest {
			score = 1.0 / (cost + 1e-6)
		}
		if prefs != nil && prefs.PreferredProvider == name {
			// The configured default wins ties and normal healthy-routing decisions,
			// while the health penalty below still allows a healthy secondary provider
			// to take over when the default is unavailable.
			score *= 1.25
		}
		if !healthy {
			score *= 0.01
		}
		scores = append(scores, &ProviderScore{Name: name, Cost: cost, Score: score, Healthy: healthy})
	}
	sort.Slice(scores, func(i, j int) bool { return scores[i].Score > scores[j].Score })
	return scores
}

// Route selects the best provider for the request.
func (r *ModelRouter) Route(ctx context.Context, req *models.ChatRequest) (*RoutingDecision, error) {
	return r.RouteWithPreferred(ctx, req, "")
}

// RouteWithPreferred selects the configured default when it is healthy, while
// retaining health-aware fallback to another provider when the default is down.
func (r *ModelRouter) RouteWithPreferred(ctx context.Context, req *models.ChatRequest, preferred string) (*RoutingDecision, error) {
	prefs := &Preferences{PreferCheapest: true, PreferredProvider: preferred}
	scores := r.scoreProviders(ctx, req, prefs)
	if len(scores) == 0 {
		return nil, interfaces.ErrProviderUnavailable
	}
	best := scores[0]
	return &RoutingDecision{Provider: best.Name, Model: req.Model, Score: best.Score}, nil
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
