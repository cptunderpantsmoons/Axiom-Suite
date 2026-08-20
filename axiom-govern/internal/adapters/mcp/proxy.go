// Package mcp implements an MCP stdio proxy that fronts LLM providers.
package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/laiw/management-harness/internal/core/deps"
	"github.com/laiw/management-harness/internal/core/models"
)

// JSON-RPC envelope types (minimal subset).
type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  interface{}     `json:"result,omitempty"`
	Error   *jsonRPCError   `json:"error,omitempty"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// MCPProxy proxies MCP tool calls to the harness providers.
type MCPProxy struct {
	cfg *deps.Dependencies
	log *zap.Logger
}

// NewMCPProxy constructs an MCP proxy.
func NewMCPProxy(cfg *deps.Dependencies) *MCPProxy {
	return &MCPProxy{cfg: cfg, log: zap.L().Named("mcp")}
}

// ServeStdio reads JSON-RPC messages from stdin and writes responses to stdout.
func (p *MCPProxy) ServeStdio() error {
	return p.serve(os.Stdin, os.Stdout)
}

func (p *MCPProxy) serve(in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var req jsonRPCRequest
		if err := json.Unmarshal(line, &req); err != nil {
			p.write(out, jsonRPCResponse{JSONRPC: "2.0", Error: &jsonRPCError{Code: -32700, Message: "parse error"}})
			continue
		}
		resp := p.dispatch(context.Background(), &req)
		p.write(out, resp)
	}
	return scanner.Err()
}

func (p *MCPProxy) write(out io.Writer, resp jsonRPCResponse) {
	b, err := json.Marshal(resp)
	if err != nil {
		return
	}
	_, _ = out.Write(append(b, '\n'))
}

func (p *MCPProxy) dispatch(ctx context.Context, req *jsonRPCRequest) jsonRPCResponse {
	var result interface{}
	var rpcErr *jsonRPCError
	switch req.Method {
	case "initialize":
		result, rpcErr = p.handleInitialize(req)
	case "tools/list":
		result, rpcErr = p.handleToolsList(req)
	case "tools/call":
		result, rpcErr = p.handleToolsCall(ctx, req)
	case "ping":
		result = map[string]interface{}{}
	default:
		rpcErr = &jsonRPCError{Code: -32601, Message: "method not found: " + req.Method}
	}
	return jsonRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: result, Error: rpcErr}
}

// handleInitialize implements the MCP initialize handshake.
func (p *MCPProxy) handleInitialize(req *jsonRPCRequest) (interface{}, *jsonRPCError) {
	return map[string]interface{}{
		"protocolVersion": "2024-11-05",
		"capabilities":    map[string]interface{}{"tools": map[string]interface{}{}},
		"serverInfo":      map[string]interface{}{"name": "management-harness", "version": "0.1.0"},
	}, nil
}

// handleToolsList lists the tools exposed by the proxy.
func (p *MCPProxy) handleToolsList(req *jsonRPCRequest) (interface{}, *jsonRPCError) {
	tools := []map[string]interface{}{
		{
			"name":        "chat_completion",
			"description": "Send a chat completion request through the Management Harness.",
			"inputSchema": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"model":    map[string]interface{}{"type": "string"},
					"messages": map[string]interface{}{"type": "array"},
				},
				"required": []string{"model", "messages"},
			},
		},
	}
	return map[string]interface{}{"tools": tools}, nil
}

// handleToolsCall invokes a tool, routing the request through the harness.
func (p *MCPProxy) handleToolsCall(ctx context.Context, req *jsonRPCRequest) (interface{}, *jsonRPCError) {
	var params struct {
		Name      string                 `json:"name"`
		Arguments map[string]interface{} `json:"arguments"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return nil, &jsonRPCError{Code: -32602, Message: "invalid params"}
	}
	if params.Name != "chat_completion" {
		return nil, &jsonRPCError{Code: -32602, Message: "unknown tool: " + params.Name}
	}

	model, _ := params.Arguments["model"].(string)
	messages := buildMessages(params.Arguments["messages"])
	if len(messages) == 0 {
		return nil, &jsonRPCError{Code: -32602, Message: "messages are required"}
	}
	chatReq := &models.ChatRequest{Model: model, Messages: messages}

	// Governance: run the same guardian + budget pipeline as the HTTP proxy so
	// MCP tool calls are not an ungoverned bypass.
	if p.cfg.Config.Guardian.Enabled {
		res, err := p.cfg.Guardian.ScanRequest(ctx, chatReq)
		if err != nil {
			return nil, &jsonRPCError{Code: -32603, Message: "guardian error"}
		}
		for _, t := range res.Threats {
			if (t.Type == models.ThreatPromptInjection && p.cfg.Config.Guardian.BlockInjection) ||
				(t.Type == models.ThreatJailbreak && p.cfg.Config.Guardian.BlockJailbreak) {
				return nil, &jsonRPCError{Code: -32603, Message: "request blocked by security policy"}
			}
		}
		if res.RedactedMessages != nil {
			chatReq.Messages = res.RedactedMessages
		}
	}

	providerName := p.cfg.Config.Proxy.DefaultProvider
	provider, ok := p.cfg.Providers.Snapshot()[providerName]
	if !ok {
		return nil, &jsonRPCError{Code: -32603, Message: fmt.Sprintf("provider %q unavailable", providerName)}
	}

	identity := &models.Identity{UserID: "mcp", Roles: []string{"system"}}
	if p.cfg.Config.Proxy.RequireAuth {
		// Price through the configured model (GPU-hour for local providers) so the
		// MCP path budgets like the HTTP gateway; fall back on error.
		var cost float64
		if p.cfg.Pricing != nil {
			var chars int
			for _, m := range chatReq.Messages {
				chars += len(m.Content)
			}
			est := models.Usage{PromptTokens: chars / 4, CompletionTokens: 256, TotalTokens: chars/4 + 256}
			if c, err := p.cfg.Pricing.Price(provider.Name(), chatReq.Model, est); err == nil {
				cost = c
			}
		}
		if cost == 0 {
			cost, _ = provider.EstimateCost(ctx, chatReq)
		}
		if err := p.cfg.Budget.Check(ctx, identity, cost); err != nil {
			p.audit(ctx, "mcp.request", "budget_exceeded")
			return nil, &jsonRPCError{Code: -32000, Message: "budget limit exceeded"}
		}
		resp, err := provider.ChatCompletion(ctx, chatReq)
		if err != nil {
			p.audit(ctx, "mcp.request", "failure")
			return nil, &jsonRPCError{Code: -32603, Message: err.Error()}
		}
		_ = p.cfg.Budget.RecordUsage(ctx, identity, cost, resp.Usage.TotalTokens)
		text := redactResponse(p, ctx, resp)
		p.audit(ctx, "mcp.request", "success")
		return p.result(text), nil
	}

	resp, err := provider.ChatCompletion(ctx, chatReq)
	if err != nil {
		p.audit(ctx, "mcp.request", "failure")
		return nil, &jsonRPCError{Code: -32603, Message: err.Error()}
	}
	text := redactResponse(p, ctx, resp)
	p.audit(ctx, "mcp.request", "success")
	return p.result(text), nil
}

func (p *MCPProxy) result(text string) map[string]interface{} {
	return map[string]interface{}{
		"content": []map[string]interface{}{
			{"type": "text", "text": text},
		},
		"isError":     false,
		"_request_id": uuid.NewString(),
	}
}

func (p *MCPProxy) audit(ctx context.Context, action, outcome string) {
	if p.cfg.Audit == nil {
		return
	}
	_ = p.cfg.Audit.Log(ctx, &models.AuditEvent{
		UserID:   "mcp",
		Action:   action,
		Resource: "mcp.tools/call",
		Outcome:  outcome,
	})
}

// redactResponse applies the guardian output sanitizer (PII redaction) when enabled.
func redactResponse(p *MCPProxy, ctx context.Context, resp *models.ChatResponse) string {
	text := ""
	if len(resp.Choices) > 0 {
		text = resp.Choices[0].Message.Content
	}
	if p.cfg.Config.Guardian.Enabled && p.cfg.Config.Guardian.RedactPII {
		if sanitized, err := p.cfg.Guardian.ScanResponse(ctx, text); err == nil {
			text = sanitized.RedactedResponse
		}
	}
	return text
}

// buildMessages converts raw JSON-RPC arguments into typed chat messages.
func buildMessages(raw interface{}) []models.Message {
	rawMessages, _ := raw.([]interface{})
	messages := make([]models.Message, 0, len(rawMessages))
	for _, m := range rawMessages {
		mm, ok := m.(map[string]interface{})
		if !ok {
			continue
		}
		role, _ := mm["role"].(string)
		content, _ := mm["content"].(string)
		messages = append(messages, models.Message{Role: role, Content: content})
	}
	return messages
}
