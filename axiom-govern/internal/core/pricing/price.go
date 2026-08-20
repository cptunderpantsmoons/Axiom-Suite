// Package pricing provides a static model pricing table implementing
// interfaces.Pricing. Prices are USD per 1K tokens (input/output) and are
// intentionally conservative: they over-estimate rather than under-estimate
// so budget enforcement is never fooled by a cheap model.
package pricing

import (
	"strings"

	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

// rateTable maps "<provider>:<model>" -> [inputPer1k, outputPer1k] in USD.
var rateTable = map[string][2]float64{
	// OpenAI.
	"openai:gpt-4o":        {2.50, 10.00},
	"openai:gpt-4o-mini":   {0.15, 0.60},
	"openai:gpt-4-turbo":   {10.00, 30.00},
	"openai:gpt-3.5-turbo": {0.50, 1.50},
	"openai:o1-mini":       {1.10, 4.40},
	"openai:o1-preview":    {15.00, 60.00},
	// Anthropic.
	"anthropic:claude-3-5-sonnet-20241022": {3.00, 15.00},
	"anthropic:claude-3-5-haiku-20241022":  {0.80, 4.00},
	"anthropic:claude-3-opus-20240229":     {15.00, 75.00},
	"anthropic:claude-3-7-sonnet-20250219": {3.00, 15.00},
}

// Default returns the conservative default pricing source backed by the
// built-in model price table.
func Default() interfaces.Pricing {
	return DefaultPricing{}
}

// DefaultPricing is the fallback pricing source used when no override is
// supplied. Unknown models fall back to a conservative default rate.
type DefaultPricing struct{}

// Price returns the USD cost for the given usage.
func (DefaultPricing) Price(provider, model string, usage models.Usage) (float64, error) {
	rate, ok := rateTable[strings.ToLower(strings.TrimSpace(provider)+":"+strings.TrimSpace(model))]
	if !ok {
		// Conservative fallback: $3 in / $9 out per 1K tokens.
		rate = [2]float64{3.00, 9.00}
	}
	cost := (float64(usage.PromptTokens)*rate[0] + float64(usage.CompletionTokens)*rate[1]) / 1000.0
	return cost, nil
}

var _ interfaces.Pricing = DefaultPricing{}