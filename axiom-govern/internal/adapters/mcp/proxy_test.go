package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/components/budget"
	"github.com/laiw/management-harness/internal/components/guardian"
	"github.com/laiw/management-harness/internal/core/config"
	"github.com/laiw/management-harness/internal/core/deps"
	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
	"github.com/laiw/management-harness/internal/core/providers"
	"github.com/laiw/management-harness/internal/observability/audit"
)

type stubProvider struct{}

func (stubProvider) ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error) {
	return &models.ChatResponse{
		Model:   req.Model,
		Choices: []models.Choice{{Index: 0, Message: models.Message{Role: "assistant?", Content: "stub response"}}},
		Usage:   models.Usage{PromptTokens: 1, CompletionTokens: 1, TotalTokens: 2},
	}, nil
}
func (stubProvider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error) {
	return nil, nil
}
func (stubProvider) Name() string                          { return "stub" }
func (stubProvider) HealthCheck(ctx context.Context) error { return nil }
func (stubProvider) EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error) {
	return 0.01, nil
}

func newTestProxy() *MCPProxy {
	cfg := &config.Config{}
	cfg.Proxy.DefaultProvider = "stub"
	cfg.Proxy.RequireAuth = false
	cfg.Guardian.Enabled = true
	cfg.Guardian.RedactPII = true
	cfg.Guardian.BlockInjection = true
	cfg.Guardian.BlockJailbreak = true
	d := &deps.Dependencies{
		Config:    cfg,
		Providers: providers.NewRegistry(map[string]interfaces.LLMProvider{"stub": stubProvider{}}),
		Guardian:  guardian.NewGuardian(nil, nil, nil).WithOptions(guardian.Options{BlockInjection: true, BlockJailbreak: true, RedactPII: true}),
		Budget:    budget.NewBudgetEnforcer(budget.NewMemoryBudgetStore(), nil, nil),
		Audit:     audit.NewAuditLogger(nil),
	}
	d.Audit.Start(context.Background())
	return NewMCPProxy(d)
}

func TestDispatchToolsCall(t *testing.T) {
	p := newTestProxy()
	req := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      json.RawMessage(`1`),
		Method:  "tools/call",
		Params:  json.RawMessage(`{"name":"chat_completion","arguments":{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}}`),
	}
	resp := p.dispatch(context.Background(), &req)
	require.Nil(t, resp.Error)
	result, ok := resp.Result.(map[string]interface{})
	require.True(t, ok)
	content := result["content"].([]map[string]interface{})
	assert.Equal(t, "stub response", content[0]["text"])
}

func TestServeStdioLoop(t *testing.T) {
	p := newTestProxy()
	in := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
	}, "\n")
	var out bytes.Buffer
	require.NoError(t, p.serve(strings.NewReader(in), &out))

	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	require.Len(t, lines, 2)
	var r1, r2 jsonRPCResponse
	require.NoError(t, json.Unmarshal([]byte(lines[0]), &r1))
	require.NoError(t, json.Unmarshal([]byte(lines[1]), &r2))
	assert.NotNil(t, r1.Result)
	assert.NotNil(t, r2.Result)
}
