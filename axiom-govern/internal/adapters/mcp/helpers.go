// Package mcp implements an MCP stdio proxy that fronts LLM providers.
package mcp

import (
	"github.com/laiw/management-harness/internal/core/models"
)

// buildChatRequest converts MCP tool arguments into a ChatRequest.
func buildChatRequest(model string, messages []map[string]interface{}) *models.ChatRequest {
	out := &models.ChatRequest{Model: model, Messages: []models.Message{}}
	for _, m := range messages {
		role, _ := m["role"].(string)
		content, _ := m["content"].(string)
		out.Messages = append(out.Messages, models.Message{Role: role, Content: content})
	}
	return out
}
