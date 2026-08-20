package anthropic

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/core/models"
)

func TestSystemMessagesUseTopLevelField(t *testing.T) {
	var body map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg1","model":"claude-3","content":[{"type":"text","text":"ok"}],"usage":{"input_tokens":1,"output_tokens":1}}`))
	}))
	defer srv.Close()

	p := NewProvider("sk-test", srv.URL)
	_, err := p.ChatCompletion(context.Background(), &models.ChatRequest{
		Model: "claude-3",
		Messages: []models.Message{
			{Role: "system", Content: "You are concise."},
			{Role: "user", Content: "hello"},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, "You are concise.", body["system"])
	messages, ok := body["messages"].([]interface{})
	require.True(t, ok)
	require.Len(t, messages, 1)
}

func TestChatCompletionMapping(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/messages", r.URL.Path)
		assert.Equal(t, "sk-test", r.Header.Get("x-api-key"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"msg1","type":"message","model":"claude-3","content":[{"type":"text","text":"hello there"}],"usage":{"input_tokens":4,"output_tokens":3}}`))
	}))
	defer srv.Close()

	p := NewProvider("sk-test", srv.URL)
	resp, err := p.ChatCompletion(context.Background(), &models.ChatRequest{Model: "claude-3", Messages: []models.Message{{Role: "user", Content: "hi"}}})
	require.NoError(t, err)
	assert.Equal(t, "hello there", resp.Choices[0].Message.Content)
	assert.Equal(t, 7, resp.Usage.TotalTokens)
}
