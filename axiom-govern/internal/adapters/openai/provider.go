// Package openai implements an OpenAI-compatible LLM provider.
package openai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

// Provider is an OpenAI-compatible LLM provider.
type Provider struct {
	name       string
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

// NewProvider constructs an OpenAI provider. If baseURL is empty, the default
// OpenAI endpoint is used. name is the registry provider key (e.g. "local-h100")
// used for pricing identity — it must be distinct from the literal "openai" so
// local vs hosted backends cost differently.
func NewProvider(name, apiKey, baseURL string) *Provider {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	// Trim a trailing slash so the concrete request paths never double up
	// (e.g. ".../gateway/v1/" + "/chat/completions").
	baseURL = strings.TrimRight(baseURL, "/")
	if name == "" {
		name = "openai"
	}
	return &Provider{
		name:       name,
		apiKey:     apiKey,
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 120 * time.Second},
	}
}

// Name returns the provider name (the configured registry key).
func (p *Provider) Name() string { return p.name }

// ChatCompletion performs a non-streaming chat completion.
func (p *Provider) ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error) {
	request := *req
	request.Stream = false
	body, err := json.Marshal(&request)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/chat/completions", bytes.NewReader(body))
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
		return nil, fmt.Errorf("openai error %d: %s", resp.StatusCode, string(b))
	}
	var out models.ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &out, nil
}

// ChatCompletionStream performs a streaming chat completion, returning chunks.
func (p *Provider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error) {
	request := *req
	request.Stream = true
	body, err := json.Marshal(&request)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/chat/completions", bytes.NewReader(body))
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
		return nil, fmt.Errorf("openai error %d: %s", resp.StatusCode, string(b))
	}
	ch := make(chan *models.StreamChunk, 64)
	go func() {
		defer resp.Body.Close()
		defer close(ch)
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := scanner.Text()
			if !bytes.HasPrefix([]byte(line), []byte("data:")) {
				continue
			}
			data := bytes.TrimSpace(bytes.TrimPrefix([]byte(line), []byte("data:")))
			if string(data) == "[DONE]" {
				select {
				case ch <- &models.StreamChunk{Done: true}:
				case <-ctx.Done():
				}
				return
			}
			var chunk models.StreamChunk
			if err := json.Unmarshal(data, &chunk); err != nil {
				continue
			}
			select {
			case ch <- &chunk:
			case <-ctx.Done():
				return
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

// EstimateCost returns a rough cost estimate based on token counts.
func (p *Provider) EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error) {
	tokens := estimateTokens(req)
	// Approximate pricing (USD per 1K tokens): $0.01 in / $0.03 out for gpt-4o-class.
	return (float64(tokens.input) * 0.01 / 1000) + (float64(tokens.output) * 0.03 / 1000), nil
}

func (p *Provider) setHeaders(r *http.Request) {
	r.Header.Set("Content-Type", "application/json")
	// Keyless free tiers (Kilo, OpenCode Zen) must NOT send an empty bearer
	// token; omit the header entirely when no key is configured.
	if p.apiKey != "" {
		r.Header.Set("Authorization", "Bearer "+p.apiKey)
	}
	r.Header.Set("Accept", "application/json")
}

type tokenEstimate struct {
	input  int
	output int
}

func estimateTokens(req *models.ChatRequest) tokenEstimate {
	var chars int
	for _, m := range req.Messages {
		chars += len(m.Content)
	}
	input := chars / 4
	output := 256
	if req.MaxTokens != nil {
		output = *req.MaxTokens
	}
	return tokenEstimate{input: input, output: output}
}

// compile-time assertion that Provider satisfies the interface.
var _ interfaces.LLMProvider = (*Provider)(nil)
