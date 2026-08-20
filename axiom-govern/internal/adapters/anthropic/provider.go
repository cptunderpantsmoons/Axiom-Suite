// Package anthropic implements an Anthropic Messages API provider.
package anthropic

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

// Provider is an Anthropic Messages API provider.
type Provider struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

// NewProvider constructs an Anthropic provider.
func NewProvider(apiKey, baseURL string) *Provider {
	if baseURL == "" {
		baseURL = "https://api.anthropic.com/v1"
	}
	return &Provider{
		apiKey:     apiKey,
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}
}

// Name returns the provider name.
func (p *Provider) Name() string { return "anthropic" }

type anthropicRequest struct {
	Model     string         `json:"model"`
	System    string         `json:"system,omitempty"`
	Messages  []anthropicMsg `json:"messages"`
	MaxTokens int            `json:"max_tokens"`
	Stream    bool           `json:"stream,omitempty"`
}

type anthropicMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicResponse struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Model   string `json:"model"`
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

// ChatCompletion performs a non-streaming completion via the Messages API.
func (p *Provider) ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error) {
	ar := p.toAnthropicRequest(req, false)
	body, err := json.Marshal(ar)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	p.setHeaders(httpReq)
	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("anthropic error %d: %s", resp.StatusCode, string(b))
	}
	var ar2 anthropicResponse
	if err := json.NewDecoder(resp.Body).Decode(&ar2); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return p.fromAnthropicResponse(&ar2), nil
}

// ChatCompletionStream performs a streaming completion.
func (p *Provider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error) {
	ar := p.toAnthropicRequest(req, true)
	body, err := json.Marshal(ar)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	p.setHeaders(httpReq)
	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("anthropic error %d: %s", resp.StatusCode, string(b))
	}
	ch := make(chan *models.StreamChunk, 64)
	go func() {
		defer resp.Body.Close()
		defer close(ch)
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			const prefix = "data:"
			if len(line) <= len(prefix) || line[:len(prefix)] != prefix {
				continue
			}
			data := bytes.TrimSpace([]byte(line[len(prefix):]))
			var evt struct {
				Type  string `json:"type"`
				Delta struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			}
			if err := json.Unmarshal(data, &evt); err != nil {
				continue
			}
			if evt.Type == "message_stop" {
				select {
				case ch <- &models.StreamChunk{Done: true}:
				case <-ctx.Done():
				}
				return
			}
			if evt.Type == "content_block_delta" && evt.Delta.Type == "text_delta" {
				chunk := &models.StreamChunk{Model: req.Model, Choices: []models.StreamChoice{{Index: 0, Delta: models.Message{Role: "assistant", Content: evt.Delta.Text}}}}
				select {
				case ch <- chunk:
				case <-ctx.Done():
					return
				}
			}
		}
		if err := scanner.Err(); err != nil {
			select {
			case ch <- &models.StreamChunk{Error: err.Error()}:
			case <-ctx.Done():
			}
		}
	}()
	return ch, nil
}

// HealthCheck verifies connectivity to the provider.
func (p *Provider) HealthCheck(ctx context.Context) error {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, p.baseURL+"/models", nil)
	if err != nil {
		return err
	}
	p.setHeaders(httpReq)
	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check failed: status %d", resp.StatusCode)
	}
	return nil
}

// EstimateCost returns a rough cost estimate.
func (p *Provider) EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error) {
	var chars int
	for _, m := range req.Messages {
		chars += len(m.Content)
	}
	input := chars / 4
	output := 256
	if req.MaxTokens != nil {
		output = *req.MaxTokens
	}
	// Approximate Claude pricing: $0.003 in / $0.015 out per 1K tokens.
	return (float64(input) * 0.003 / 1000) + (float64(output) * 0.015 / 1000), nil
}

func (p *Provider) toAnthropicRequest(req *models.ChatRequest, stream bool) anthropicRequest {
	msgs := make([]anthropicMsg, 0, len(req.Messages))
	var system string
	for _, m := range req.Messages {
		if m.Role == "system" {
			if system != "" {
				system += "\n"
			}
			system += m.Content
			continue
		}
		msgs = append(msgs, anthropicMsg{Role: m.Role, Content: m.Content})
	}
	maxTokens := 1024
	if req.MaxTokens != nil {
		maxTokens = *req.MaxTokens
	}
	return anthropicRequest{Model: req.Model, System: system, Messages: msgs, MaxTokens: maxTokens, Stream: stream}
}

func (p *Provider) fromAnthropicResponse(ar *anthropicResponse) *models.ChatResponse {
	var text string
	for _, c := range ar.Content {
		text += c.Text
	}
	return &models.ChatResponse{
		ID:    ar.ID,
		Model: ar.Model,
		Choices: []models.Choice{{
			Index:        0,
			Message:      models.Message{Role: "assistant", Content: text},
			FinishReason: "stop",
		}},
		Usage: models.Usage{
			PromptTokens:     ar.Usage.InputTokens,
			CompletionTokens: ar.Usage.OutputTokens,
			TotalTokens:      ar.Usage.InputTokens + ar.Usage.OutputTokens,
		},
	}
}

func (p *Provider) setHeaders(r *http.Request) {
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("x-api-key", p.apiKey)
	r.Header.Set("anthropic-version", "2023-06-01")
	r.Header.Set("Accept", "application/json")
}

// compile-time assertion that Provider satisfies the interface.
var _ interfaces.LLMProvider = (*Provider)(nil)
