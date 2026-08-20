// Package models defines the core data structures used across the Management Harness.
package models

// ChatRequest is an OpenAI-compatible chat completion request.
type ChatRequest struct {
	Model       string            `json:"model"`
	Messages    []Message         `json:"messages"`
	Temperature *float64          `json:"temperature,omitempty"`
	MaxTokens   *int              `json:"max_tokens,omitempty"`
	Stream      bool              `json:"stream,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`

	// Skill references a gateway-defined skill (e.g. "summarize"). SkillParams
	// carries the slot values. Both are gateway-local: they are resolved and
	// stripped before the request is forwarded upstream.
	Skill       string         `json:"skill,omitempty"`
	SkillParams map[string]any `json:"skill_params,omitempty"`

	// Axiom is gateway-local provenance and intent metadata. The proxy validates
	// it and strips it before forwarding the request upstream.
	Axiom *AxiomRequestEnvelope `json:"axiom,omitempty"`
}

// Message is a single chat message.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatResponse is an OpenAI-compatible chat completion response.
type ChatResponse struct {
	ID      string   `json:"id"`
	Object  string   `json:"object,omitempty"`
	Created int64    `json:"created,omitempty"`
	Model   string   `json:"model"`
	Choices []Choice `json:"choices"`
	Usage   Usage    `json:"usage"`
}

// Choice is a completion choice.
type Choice struct {
	Index        int     `json:"index"`
	Message      Message `json:"message"`
	FinishReason string  `json:"finish_reason"`
}

// Usage is token usage information.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// StreamChoice is a single choice within a streaming chunk.
type StreamChoice struct {
	Index        int     `json:"index"`
	Delta        Message `json:"delta"`
	FinishReason string  `json:"finish_reason"`
}

// StreamChunk is a single Server-Sent Events chunk for streaming responses.
type StreamChunk struct {
	ID      string         `json:"id"`
	Object  string         `json:"object,omitempty"`
	Created int64          `json:"created,omitempty"`
	Model   string         `json:"model"`
	Choices []StreamChoice `json:"choices"`
	// Done and Error are gateway-internal stream lifecycle signals and are not
	// serialized into normal upstream-compatible chunks.
	Done  bool   `json:"-"`
	Error string `json:"-"`
}
