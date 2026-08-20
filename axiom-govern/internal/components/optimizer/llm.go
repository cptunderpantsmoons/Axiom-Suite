package optimizer

import (
	"context"
	"errors"
	"strings"

	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

var errEmptyCompletion = errors.New("empty LLM completion")

// LLMCompressor uses an LLM provider (e.g. NVIDIA Nemotron on build.nvidia.com)
// to rewrite/compress a prompt while preserving facts, numbers, constraints and
// named entities. It is lossy, so it should only be used behind the optimizer's
// semantic-preservation gate and the per-skill Optimize opt-in.
type LLMCompressor struct {
	provider interfaces.LLMProvider
	model    string
	system   string
}

// NewLLMCompressor constructs an LLM-backed compressor.
func NewLLMCompressor(provider interfaces.LLMProvider, model string) *LLMCompressor {
	return &LLMCompressor{
		provider: provider,
		model:    model,
		system: "You are an expert prompt optimiser. Rewrite the user's instruction to be " +
			"more concise and cost-efficient while preserving ALL facts, numbers, constraints, " +
			"named entities, and intent. Remove only redundant filler and verbosity. " +
			"Return only the optimised prompt and nothing else.",
	}
}

// Compress implements Compressor.
func (c *LLMCompressor) Compress(ctx context.Context, prompt string) (string, error) {
	if c.provider == nil {
		return prompt, nil
	}
	maxTokens := 1500
	resp, err := c.provider.ChatCompletion(ctx, &models.ChatRequest{
		Model: c.model,
		Messages: []models.Message{
			{Role: "system", Content: c.system},
			{Role: "user", Content: prompt},
		},
		MaxTokens: &maxTokens,
	})
	if err != nil {
		return "", err
	}
	if len(resp.Choices) == 0 {
		return "", errEmptyCompletion
	}
	out := strings.TrimSpace(resp.Choices[0].Message.Content)
	if out == "" {
		return "", errEmptyCompletion
	}
	return out, nil
}