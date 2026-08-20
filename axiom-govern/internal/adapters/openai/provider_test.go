package openai

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/core/models"
)

func TestChatCompletionParsing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/chat/completions", r.URL.Path)
		assert.Contains(t, r.Header.Get("Authorization"), "Bearer")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"c1","model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}`))
	}))
	defer srv.Close()

	p := NewProvider("openai", "sk-test", srv.URL)
	resp, err := p.ChatCompletion(context.Background(), &models.ChatRequest{Model: "gpt-4o", Messages: []models.Message{{Role: "user", Content: "hi"}}})
	require.NoError(t, err)
	assert.Equal(t, "hi", resp.Choices[0].Message.Content)
	assert.Equal(t, 7, resp.Usage.TotalTokens)
}

func TestKeylessFreeTierOmitsAuthHeader(t *testing.T) {
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		assert.Equal(t, "/chat/completions", r.URL.Path, "trailing slash must be trimmed")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"total_tokens":2}}`))
	}))
	defer srv.Close()

	p := NewProvider("kilo", "", srv.URL+"/")
	_, err := p.ChatCompletion(context.Background(), &models.ChatRequest{Model: "tencent/hy3:free", Messages: []models.Message{{Role: "user", Content: "hi"}}})
	require.NoError(t, err)
	assert.Equal(t, "", auth, "keyless provider must omit the Authorization header")
}

func TestChatCompletionStreamSignalsCompletion(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		payload := `data: {"model":"gpt-4o","choices":[{"delta":{"content":"hello"}}]}` + "\n\ndata: [DONE]\n\n"
		_, _ = w.Write([]byte(payload))
	}))
	defer srv.Close()

	p := NewProvider("openai", "sk-test", srv.URL)
	chunks, err := p.ChatCompletionStream(context.Background(), &models.ChatRequest{Model: "gpt-4o"})
	require.NoError(t, err)
	var sawDone bool
	for chunk := range chunks {
		if chunk.Done {
			sawDone = true
		}
	}
	assert.True(t, sawDone)
}

func TestChatCompletionStreamReportsScannerErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: " + strings.Repeat("x", 2*1024*1024) + "\n"))
	}))
	defer srv.Close()

	p := NewProvider("openai", "sk-test", srv.URL)
	chunks, err := p.ChatCompletionStream(context.Background(), &models.ChatRequest{Model: "gpt-4o"})
	require.NoError(t, err)
	var sawError bool
	for chunk := range chunks {
		if chunk.Error != "" {
			sawError = true
		}
	}
	assert.True(t, sawError)
}

func TestEstimateCost(t *testing.T) {
	p := NewProvider("openai", "sk", "")
	cost, err := p.EstimateCost(context.Background(), &models.ChatRequest{Model: "gpt-4o", Messages: []models.Message{{Role: "user", Content: "hello world"}}})
	require.NoError(t, err)
	assert.Greater(t, cost, 0.0)
}
