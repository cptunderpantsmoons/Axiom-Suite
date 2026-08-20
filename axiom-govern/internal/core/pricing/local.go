// Package pricing provides cost models for the Management Harness.
package pricing

import (
	"math"
	"strings"

	"github.com/laiw/management-harness/internal/core/config"
	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

// localPricing prices a self-hosted provider by GPU-hour wall-clock cost at a
// conservative declared throughput, with a per-request GPU-second floor so a
// tiny request cannot evade the budget by holding a GPU. It is intentionally
// conservative (over-accrual) like the per-token table.
type localPricing struct {
	cfg config.LocalProviderConfig
}

func (l localPricing) Price(provider, model string, usage models.Usage) (float64, error) {
	gpus := float64(max(l.cfg.GPUCount, 1))
	hourCost := safePositive(l.cfg.GPUHourCost, 0) * gpus
	tps := safePositive(l.cfg.DeclaredThroughputTPS, 10)
	safety := safePositive(l.cfg.SafetyFactor, 1.25)
	// effective cost per 1K tokens = hourCost * safety / (3600 * throughput)
	rate1k := (hourCost * safety) / (3600 * tps) * 1000
	cost := float64(usage.TotalTokens) * rate1k / 1000
	// floor: charge at least one GPU-second per request
	floor := hourCost / 3600 * safePositive(l.cfg.MinGPUSecondsPerRequest, 0)
	return math.Max(cost, floor), nil
}

func safePositive(v, def float64) float64 {
	if v > 0 {
		return v
	}
	return def
}

// Multi resolves a Pricing strategy per provider name, falling back to a
// default for unlisted providers.
type Multi struct {
	def        interfaces.Pricing
	byProvider map[string]interfaces.Pricing
}

// Price implements interfaces.Pricing.
func (m Multi) Price(provider, model string, usage models.Usage) (float64, error) {
	if p, ok := m.byProvider[provider]; ok {
		return p.Price(provider, model, usage)
	}
	return m.def.Price(provider, model, usage)
}

// Build returns a Pricing that routes `type: local` providers to GPU-hour cost
// accounting and everything else to the default per-token table. Local pricing
// is only used when gpu_hour_cost is configured.
func Build(def interfaces.Pricing, providers map[string]config.ProviderConfig) interfaces.Pricing {
	strategies := map[string]interfaces.Pricing{}
	for name, pc := range providers {
		if strings.ToLower(pc.Type) == "local" && pc.Local.GPUHourCost > 0 {
			strategies[name] = localPricing{cfg: pc.Local}
		}
	}
	return Multi{def: def, byProvider: strategies}
}