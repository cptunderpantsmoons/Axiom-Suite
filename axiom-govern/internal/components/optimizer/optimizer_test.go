package optimizer

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/core/models"
)

func TestOptimizeNormalizesWhitespace(t *testing.T) {
	o := NewPromptOptimizer(nil, nil, nil)
	res, err := o.Optimize(context.Background(), "Please   summarize\nthe\n\nquarterly report", nil)
	require.NoError(t, err)
	assert.True(t, res.SemanticsPreserved)
	assert.Equal(t, "Please summarize the quarterly report", res.Optimized)
	assert.Less(t, res.OptimizedLength, res.OriginalLength)
}

func TestOptimizePreservesCase(t *testing.T) {
	o := NewPromptOptimizer(nil, nil, nil)
	res, err := o.Optimize(context.Background(), "Compare  US   and  SQL  identifiers", nil)
	require.NoError(t, err)
	assert.Equal(t, "Compare US and SQL identifiers", res.Optimized)
}

func TestShadowModeDoesNotApply(t *testing.T) {
	o := NewPromptOptimizer(nil, nil, nil).WithShadowMode(true)
	res, err := o.Optimize(context.Background(), "Please write a function that sorts an array", nil)
	assert.NoError(t, err)
	assert.False(t, res.Applied)
	assert.Equal(t, res.OriginalLength, res.OptimizedLength)
}

type fakeProvider struct {
	out string
}

func (f *fakeProvider) ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error) {
	return &models.ChatResponse{Choices: []models.Choice{{Index: 0, Message: models.Message{Role: "assistant", Content: f.out}}}}, nil
}
func (f *fakeProvider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error) {
	return nil, nil
}
func (f *fakeProvider) Name() string                          { return "fake" }
func (f *fakeProvider) HealthCheck(ctx context.Context) error { return nil }
func (f *fakeProvider) EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error) {
	return 0.01, nil
}

func TestLLMCompressorAndGatedApply(t *testing.T) {
	original := "Please summarize the quarterly report for the board meeting"
	comp := NewLLMCompressor(&fakeProvider{out: "summarize the quarterly report for the board meeting"}, "nemotron")

	got, err := comp.Compress(context.Background(), original)
	require.NoError(t, err)
	assert.Equal(t, "summarize the quarterly report for the board meeting", got)

	o := NewPromptOptimizer(comp, nil, nil).WithShadowMode(false)
	res, err := o.Optimize(context.Background(), original, nil)
	require.NoError(t, err)
	assert.True(t, res.Applied, "lossless-preserving LLM rewrite should apply")
	assert.Equal(t, "summarize the quarterly report for the board meeting", res.Optimized)
}

func TestLLMCompressorDriftedOutputRejected(t *testing.T) {
	// A model output with no semantic overlap must be rejected (fall back).
	o := NewPromptOptimizer(NewLLMCompressor(&fakeProvider{out: "irrelevant unrelated output"}, "nemotron"), nil, nil).WithShadowMode(false)
	res, err := o.Optimize(context.Background(), "Please summarize the quarterly report", nil)
	require.NoError(t, err)
	assert.False(t, res.Applied)
	assert.Equal(t, "Please summarize the quarterly report", res.Optimized)
}