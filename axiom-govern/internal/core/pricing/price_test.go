package pricing

import (
	"testing"

	"github.com/laiw/management-harness/internal/core/config"
	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDefaultPricingKnownModel(t *testing.T) {
	p := DefaultPricing{}
	// gpt-4o: $2.50 in / $10.00 out per 1K tokens.
	cost, err := p.Price("openai", "gpt-4o", models.Usage{
		PromptTokens: 1000, CompletionTokens: 500, TotalTokens: 1500,
	})
	require.NoError(t, err)
	// 1000*2.50/1000 + 500*10.00/1000 = 2.50 + 5.00 = 7.50
	assert.InDelta(t, 7.50, cost, 1e-9)
}

func TestDefaultPricingUnknownModelFallsBack(t *testing.T) {
	p := DefaultPricing{}
	cost, err := p.Price("openai", "gpt-unknown-99", models.Usage{
		PromptTokens: 1000, CompletionTokens: 0,
	})
	require.NoError(t, err)
	// Fallback: $3.00 in per 1K tokens.
	assert.InDelta(t, 3.00, cost, 1e-9)
}

func TestDefaultPricingCaseInsensitive(t *testing.T) {
	p := DefaultPricing{}
	a, _ := p.Price("OpenAI", "GPT-4o", models.Usage{PromptTokens: 1000, CompletionTokens: 0})
	b, _ := p.Price("openai", "gpt-4o", models.Usage{PromptTokens: 1000, CompletionTokens: 0})
	assert.Equal(t, a, b)
}

func TestDefaultPricingZeroUsage(t *testing.T) {
	p := DefaultPricing{}
	cost, err := p.Price("openai", "gpt-4o", models.Usage{})
	require.NoError(t, err)
	assert.Equal(t, 0.0, cost)
}

func TestLocalPricingUsesGPUHours(t *testing.T) {
	// H100 @ $2.50/hr, 1 GPU, declared 90 tok/s, safety 1.25.
	// rate per 1K = (2.5*1*1.25)/(3600*90)*1000 = ~0.00965
	p := localPricing{cfg: config.LocalProviderConfig{
		GPUHourCost: 2.5, GPUCount: 1, DeclaredThroughputTPS: 90, SafetyFactor: 1.25,
	}}
	cost, err := p.Price("local-h100", "my-model", models.Usage{TotalTokens: 100_000})
	require.NoError(t, err)
	expected := (2.5 * 1 * 1.25) / (3600 * 90) * 1000 * 100 // 100k tokens
	assert.InDelta(t, expected, cost, 1e-9)
	assert.Greater(t, cost, 0.0)
}

func TestLocalPricingRequestFloor(t *testing.T) {
	// A tiny request must still pay the GPU-second floor.
	p := localPricing{cfg: config.LocalProviderConfig{
		GPUHourCost: 2.5, GPUCount: 1, DeclaredThroughputTPS: 800,
		MinGPUSecondsPerRequest: 3,
	}}
	cost, err := p.Price("local", "m", models.Usage{TotalTokens: 1})
	require.NoError(t, err)
	assert.GreaterOrEqual(t, cost, 2.5/3600*3) // floor
}

func TestBuildRoutesLocalToGPUButOthersDefault(t *testing.T) {
	base := DefaultPricing{}
	providers := map[string]config.ProviderConfig{
		"local-h100": {Type: "local", Local: config.LocalProviderConfig{GPUHourCost: 2.5, DeclaredThroughputTPS: 90, SafetyFactor: 1.25}},
		"openai":     {Type: "openai"},
	}
	multi := Build(base, providers).(Multi)
	require.Contains(t, multi.byProvider, "local-h100")
	require.NotContains(t, multi.byProvider, "openai")
	// openai still goes to the token default
	cost, err := multi.Price("openai", "gpt-4o", models.Usage{PromptTokens: 1000, CompletionTokens: 0})
	require.NoError(t, err)
	assert.InDelta(t, 2.50, cost, 1e-9)
	_ = interfaces.Pricing(multi) // compile-time assert Multi implements Pricing
}