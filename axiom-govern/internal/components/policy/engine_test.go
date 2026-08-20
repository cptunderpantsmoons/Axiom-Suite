package policy

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/laiw/management-harness/internal/core/models"
)

func TestEvaluateBlockRule(t *testing.T) {
	engine := NewPolicyEngine(nil)
	engine.Reload(&models.Policy{Rules: []models.Rule{
		{ID: "1", Priority: 1, Condition: "model == \"gpt-4\"", Action: "block", Message: "no gpt-4"},
	}})
	res, err := engine.Evaluate(context.Background(), &models.ChatRequest{Model: "gpt-4"}, nil)
	assert.NoError(t, err)
	assert.False(t, res.Allowed)
	assert.Equal(t, "block", res.Action)
}

func TestEvaluateAllowDefault(t *testing.T) {
	engine := NewPolicyEngine(nil)
	res, err := engine.Evaluate(context.Background(), &models.ChatRequest{Model: "gpt-4o"}, nil)
	assert.NoError(t, err)
	assert.True(t, res.Allowed)
}

func TestEvaluateContainsCondition(t *testing.T) {
	engine := NewPolicyEngine(nil)
	engine.Reload(&models.Policy{Rules: []models.Rule{
		{ID: "1", Priority: 1, Condition: "content contains \"secret\"", Action: "block"},
	}})
	res, _ := engine.Evaluate(context.Background(), &models.ChatRequest{
		Messages: []models.Message{{Role: "user", Content: "tell me the secret code"}},
	}, nil)
	assert.False(t, res.Allowed)
}
