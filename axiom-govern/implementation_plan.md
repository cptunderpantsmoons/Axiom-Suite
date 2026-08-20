# Implementation Plan

## [Overview]

Build a production-ready AI Management Harness — a Go-based proxy gateway that intercepts, secures, governs, and optimizes AI tool traffic (Claude Desktop, Claude Code, Cursor, Cline, custom agents) for enterprise teams.

The Management Harness sits between end-user AI tools and upstream LLM providers (OpenAI, Anthropic, Gemini). It provides unified authentication via API keys, per-user/team/org budget enforcement, prompt injection and PII protection, policy-driven model routing, immutable audit logging, and a management dashboard for administrators. The system is designed as a standalone service with its own Docker Compose infrastructure (PostgreSQL, Redis, Prometheus, Grafana), deployable independently or alongside the existing Laiw Legal OS platform.

The implementation follows an MVP-first strategy: deliver a working proxy with authentication, budget enforcement, security guardian, and audit logging in 8 weeks, then layer on the policy engine, model router, prompt optimizer, and full management dashboard in subsequent iterations. The architecture uses a modular LEGO-style component design where each component (auth, budget, guardian, policy, router, cache, optimizer) is independently developed, tested, and deployed.

## [Types]

Define the core Go data structures, interfaces, and models that form the backbone of the Management Harness.

### Core Models

```go
// internal/core/models/request.go
package models

type ChatRequest struct {
    Model       string            `json:"model"`
    Messages    []Message         `json:"messages"`
    Temperature *float64          `json:"temperature,omitempty"`
    MaxTokens   *int              `json:"max_tokens,omitempty"`
    Stream      bool              `json:"stream,omitempty"`
    Metadata    map[string]string `json:"metadata,omitempty"`
}

type Message struct {
    Role    string `json:"role"`
    Content string `json:"content"`
}

type ChatResponse struct {
    ID      string   `json:"id"`
    Model   string   `json:"model"`
    Choices []Choice `json:"choices"`
    Usage   Usage    `json:"usage"`
}

type Choice struct {
    Index        int     `json:"index"`
    Message      Message `json:"message"`
    FinishReason string  `json:"finish_reason"`
}

type Usage struct {
    PromptTokens     int `json:"prompt_tokens"`
    CompletionTokens int `json:"completion_tokens"`
    TotalTokens      int `json:"total_tokens"`
}

type StreamChunk struct {
    ID      string  `json:"id"`
    Model   string  `json:"model"`
    Choices []struct {
        Delta struct {
            Content string `json:"content"`
        } `json:"delta"`
        FinishReason string `json:"finish_reason"`
    } `json:"choices"`
}
```

### Identity & Auth Models

```go
// internal/core/models/identity.go
package models

type Identity struct {
    UserID    string   `json:"user_id"`
    Email     string   `json:"email"`
    Name      string   `json:"name"`
    TeamID    string   `json:"team_id,omitempty"`
    OrgID     string   `json:"org_id,omitempty"`
    Roles     []string `json:"roles"`
    APIKeyID  string   `json:"api_key_id"`
    IsAdmin   bool     `json:"is_admin"`
}

type APIKey struct {
    ID        string    `json:"id"`
    KeyHash   string    `json:"key_hash"`    // SHA-256 of the raw key
    Prefix    string    `json:"prefix"`      // First 8 chars for display
    UserID    string    `json:"user_id"`
    TeamID    string    `json:"team_id,omitempty"`
    OrgID     string    `json:"org_id,omitempty"`
    CreatedAt time.Time `json:"created_at"`
    ExpiresAt *time.Time `json:"expires_at,omitempty"`
    Revoked   bool      `json:"revoked"`
    RevokedAt *time.Time `json:"revoked_at,omitempty"`
    LastUsed  *time.Time `json:"last_used,omitempty"`
    RateLimit int       `json:"rate_limit"`   // Requests per minute
}
```

### Budget Models

```go
// internal/core/models/budget.go
package models

type Budget struct {
    ID         string    `json:"id"`
    UserID     string    `json:"user_id,omitempty"`
    TeamID     string    `json:"team_id,omitempty"`
    OrgID      string    `json:"org_id,omitempty"`
    SoftLimit  float64   `json:"soft_limit"`   // Warning threshold (USD)
    HardLimit  float64   `json:"hard_limit"`   // Blocking threshold (USD)
    Period     string    `json:"period"`       // "monthly", "quarterly", "annual"
    ResetDate  time.Time `json:"reset_date"`
    CreatedAt  time.Time `json:"created_at"`
    UpdatedAt  time.Time `json:"updated_at"`
}

type BudgetUsage struct {
    UserID       string    `json:"user_id"`
    TeamID       string    `json:"team_id,omitempty"`
    OrgID        string    `json:"org_id,omitempty"`
    Period       string    `json:"period"`
    TotalSpend   float64   `json:"total_spend"`
    TokenCount   int64     `json:"token_count"`
    RequestCount int64     `json:"request_count"`
    UpdatedAt    time.Time `json:"updated_at"`
}
```

### Security Models

```go
// internal/core/models/security.go
package models

type ThreatType string

const (
    ThreatPromptInjection  ThreatType = "prompt_injection"
    ThreatJailbreak        ThreatType = "jailbreak"
    ThreatPIIFound         ThreatType = "pii_found"
    ThreatToolEscalation   ThreatType = "tool_escalation"
    ThreatDataExfiltration ThreatType = "data_exfiltration"
    ThreatCommandInjection ThreatType = "command_injection"
)

type Severity string

const (
    SeverityLow      Severity = "low"
    SeverityMedium   Severity = "medium"
    SeverityHigh     Severity = "high"
    SeverityCritical Severity = "critical"
)

type Threat struct {
    Type     ThreatType `json:"type"`
    Severity Severity   `json:"severity"`
    Details  string     `json:"details"`
}

type SecurityScanResult struct {
    IsSafe           bool     `json:"is_safe"`
    Threats          []Threat `json:"threats"`
    RedactedPrompt   string   `json:"redacted_prompt,omitempty"`
    RedactedResponse string   `json:"redacted_response,omitempty"`
    Confidence       float64  `json:"confidence"`
}
```

### Audit Models

```go
// internal/core/models/audit.go
package models

type AuditEvent struct {
    ID           string          `json:"id"`
    Timestamp    time.Time       `json:"timestamp"`
    Hash         string          `json:"hash"`          // Hash-chain for immutability
    PreviousHash string          `json:"previous_hash"`
    UserID       string          `json:"user_id"`
    TeamID       string          `json:"team_id,omitempty"`
    APIKeyID     string          `json:"api_key_id"`
    RequestID    string          `json:"request_id"`
    Action       string          `json:"action"`        // "proxy.request", "auth.login", "budget.exceeded"
    Resource     string          `json:"resource"`      // "/v1/chat/completions"
    Outcome      string          `json:"outcome"`       // "success", "failure", "blocked"
    Details      json.RawMessage `json:"details"`
    IPAddress    string          `json:"ip_address,omitempty"`
    UserAgent    string          `json:"user_agent,omitempty"`
}
```

### Core Interfaces

```go
// internal/core/interfaces/provider.go
package interfaces

type LLMProvider interface {
    ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error)
    ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error)
    Name() string
    HealthCheck(ctx context.Context) error
    EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error)
}

// internal/core/interfaces/cache.go
type Cache interface {
    Get(ctx context.Context, key string) ([]byte, error)
    Set(ctx context.Context, key string, value []byte, ttl time.Duration) error
    Delete(ctx context.Context, key string) error
    Exists(ctx context.Context, key string) (bool, error)
}

// internal/core/interfaces/audit.go
type AuditLogger interface {
    Log(ctx context.Context, event *models.AuditEvent) error
    Flush(ctx context.Context) error
}

// internal/core/interfaces/store.go
type KeyStore interface {
    GetKey(ctx context.Context, apiKey string) (*models.APIKey, error)
    CreateKey(ctx context.Context, key *models.APIKey) error
    RevokeKey(ctx context.Context, keyID string) error
    ListKeys(ctx context.Context, userID string) ([]*models.APIKey, error)
}

type BudgetStore interface {
    GetBudget(ctx context.Context, identity *models.Identity) (*models.Budget, error)
    GetUsage(ctx context.Context, identity *models.Identity) (*models.BudgetUsage, error)
    IncrementUsage(ctx context.Context, identity *models.Identity, cost float64, tokens int) error
    SetBudget(ctx context.Context, budget *models.Budget) error
}
```

### Policy Models

```go
// internal/core/models/policy.go
package models

type Policy struct {
    Version     string    `json:"version"`
    Name        string    `json:"name"`
    Description string    `json:"description"`
    Rules       []Rule    `json:"rules"`
    Active      bool      `json:"active"`
    CreatedAt   time.Time `json:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"`
}

type Rule struct {
    ID        string                 `json:"id"`
    Priority  int                    `json:"priority"`
    Condition string                 `json:"condition"`
    Action    string                 `json:"action"`
    Message   string                 `json:"message,omitempty"`
    Params    map[string]interface{} `json:"params,omitempty"`
}
```

## [Files]

Create a new Go monorepo within the Management Harness directory with the following structure.

### New Files

```
Management Harness/
├── go.mod                          # Go module definition
├── go.sum                          # Go dependency checksums
├── Makefile                        # Build, test, lint, run commands
├── Dockerfile                      # Multi-stage build for proxy binary
├── docker-compose.yml              # Local dev infrastructure (postgres, redis, prometheus, grafana)
├── .env.example                    # Environment variable template
├── .gitignore                      # Git ignore rules
├── README.md                       # Project documentation
├── cmd/
│   ├── proxy/main.go               # Main proxy entrypoint (HTTP)
│   ├── mcp-proxy/main.go           # MCP proxy entrypoint (stdio transport)
│   └── manager/main.go             # Management API entrypoint
├── internal/
│   ├── core/
│   │   ├── models/                 # All DTOs and data structures
│   │   │   ├── request.go          # ChatRequest, ChatResponse, StreamChunk
│   │   │   ├── identity.go         # Identity, APIKey
│   │   │   ├── budget.go           # Budget, BudgetUsage
│   │   │   ├── security.go         # Threat, SecurityScanResult
│   │   │   ├── audit.go            # AuditEvent
│   │   │   └── policy.go           # Policy, Rule
│   │   ├── interfaces/             # Component contracts
│   │   │   ├── provider.go         # LLMProvider interface
│   │   │   ├── cache.go            # Cache interface
│   │   │   ├── audit.go            # AuditLogger interface
│   │   │   └── store.go            # KeyStore, BudgetStore interfaces
│   │   └── config/
│   │       └── config.go           # Configuration loading (Viper)
│   ├── components/
│   │   ├── auth/
│   │   │   ├── gateway.go          # AuthGateway — API key validation
│   │   │   ├── gateway_test.go     # Unit tests
│   │   │   └── keygen.go           # API key generation (hk_ prefix)
│   │   ├── budget/
│   │   │   ├── enforcer.go         # BudgetEnforcer — real-time budget checks
│   │   │   ├── enforcer_test.go    # Unit tests
│   │   │   └── redis_store.go      # Redis-backed budget store with Lua atomic ops
│   │   ├── guardian/
│   │   │   ├── guardian.go         # Guardian — security scanning
│   │   │   ├── patterns.go         # Injection/jailbreak detection patterns
│   │   │   ├── pii.go              # PII redaction (18 language groups)
│   │   │   └── guardian_test.go    # Unit tests
│   │   ├── policy/
│   │   │   ├── engine.go           # PolicyEngine — rule evaluation
│   │   │   ├── loader.go           # YAML policy loading with hot-reload
│   │   │   └── engine_test.go      # Unit tests
│   │   ├── router/
│   │   │   ├── router.go           # ModelRouter — cost/performance routing
│   │   │   └── router_test.go      # Unit tests
│   │   ├── optimizer/
│   │   │   ├── optimizer.go        # PromptOptimizer — compression with safeguards
│   │   │   └── optimizer_test.go   # Unit tests
│   │   └── cache/
│   │       ├── cache.go            # ResponseCache — semantic + exact matching
│   │       └── cache_test.go       # Unit tests
│   ├── adapters/
│   │   ├── openai/
│   │   │   ├── provider.go         # OpenAI provider implementation
│   │   │   └── provider_test.go    # Unit tests
│   │   ├── anthropic/
│   │   │   ├── provider.go         # Anthropic provider implementation
│   │   │   └── provider_test.go    # Unit tests
│   │   └── mcp/
│   │       ├── proxy.go            # MCP proxy server (stdio transport)
│   │       └── proxy_test.go       # Unit tests
│   ├── api/
│   │   ├── server.go               # Management REST API server
│   │   ├── routes/
│   │   │   ├── users.go            # User management endpoints
│   │   │   ├── keys.go             # API key management endpoints
│   │   │   ├── budget.go           # Budget management endpoints
│   │   │   ├── policies.go         # Policy management endpoints
│   │   │   └── audit.go            # Audit log query endpoints
│   │   └── middleware/
│   │       ├── auth.go             # JWT auth middleware for management API
│   │       └── ratelimit.go        # Rate limiting middleware
│   ├── observability/
│   │   ├── metrics/
│   │   │   └── metrics.go          # Prometheus metrics collector
│   │   └── audit/
│   │       ├── logger.go           # AuditLogger implementation
│   │       └── hashchain.go        # Hash-chain for immutability
│   └── web/                        # React dashboard (embedded via go:embed)
│       ├── package.json            # React dashboard dependencies
│       ├── vite.config.ts          # Vite build configuration
│       ├── tsconfig.json           # TypeScript configuration
│       ├── index.html              # HTML entry point
│       └── src/
│           ├── main.tsx            # React entry point
│           ├── App.tsx             # Root component with routing
│           ├── api.ts              # Typed API client for management API
│           ├── types.ts            # Shared TypeScript types
│           ├── components/
│           │   ├── Layout.tsx      # Dashboard layout with sidebar
│           │   ├── MetricCard.tsx  # Reusable metric display card
│           │   ├── DataTable.tsx   # Reusable data table with pagination
│           │   └── StatusBadge.tsx # Status indicator badge
│           └── pages/
│               ├── Overview.tsx    # Real-time usage, cost, alerts
│               ├── Usage.tsx       # Per-user, per-team, per-model analytics
│               ├── Budget.tsx      # Budget tracking and management
│               ├── Policies.tsx    # Policy editor with YAML validation
│               ├── AuditLog.tsx    # Audit log viewer with search
│               └── Admin.tsx       # User management, API keys, SSO config
├── configs/
│   ├── config.yaml                 # Main configuration
│   └── policies/
│       └── default.yaml            # Default enterprise policy
├── deployments/
│   ├── docker-compose.yml          # Production compose file
│   ├── k8s/                        # Kubernetes manifests
│   │   ├── deployment.yaml         # Proxy deployment
│   │   ├── service.yaml            # Service definitions
│   │   ├── configmap.yaml          # Configuration
│   │   └── secrets.yaml            # Secrets template
│   └── terraform/                  # Infrastructure as Code
│       ├── main.tf                 # Main infrastructure definition
│       ├── variables.tf            # Terraform variables
│       └── outputs.tf              # Terraform outputs
├── tests/
│   ├── integration/
│   │   ├── proxy_test.go           # End-to-end proxy tests
│   │   └── streaming_test.go       # SSE streaming end-to-end
│   └── e2e/
│       └── full_flow_test.go       # Full flow: auth → budget → guardian → provider
└── docs/
    ├── api/
    │   └── openapi.yaml            # OpenAPI 3.0 spec for management API
    └── guides/
        ├── claude-desktop.md       # Claude Desktop integration guide
        ├── claude-code.md          # Claude Code integration guide
        ├── cursor.md               # Cursor IDE integration guide
        └── cline.md                # Cline integration guide
```

### Configuration Files

**go.mod** — Go module with dependencies:
- `github.com/go-chi/chi/v5` — HTTP router
- `github.com/spf13/viper` — Configuration
- `github.com/redis/go-redis/v9` — Redis client
- `github.com/jackc/pgx/v5` — PostgreSQL driver
- `github.com/prometheus/client_golang` — Metrics
- `github.com/google/uuid` — UUID generation
- `golang.org/x/crypto` — Crypto utilities
- `github.com/stretchr/testify` — Testing

**docker-compose.yml** — Local dev services:
- PostgreSQL 16 (port 5432)
- Redis 7.2 (port 6379)
- Prometheus (port 9090)
- Grafana (port 3001)

## [Functions]

Define all new functions required for the Management Harness.

### New Functions

**cmd/proxy/main.go:**
- `func main()` — Entry point; loads config, initializes components, starts HTTP server
- `func setupRouter(cfg *config.Config, deps *Dependencies) http.Handler` — Configures all routes and middleware
- `func handleChatCompletion(w http.ResponseWriter, r *http.Request)` — OpenAI-compatible chat completion endpoint
- `func handleChatStream(w http.ResponseWriter, r *http.Request)` — SSE streaming endpoint
- `func handleAnthropicMessages(w http.ResponseWriter, r *http.Request)` — Anthropic-compatible messages endpoint
- `func handleHealth(w http.ResponseWriter, r *http.Request)` — Health check endpoint
- `func handleReady(w http.ResponseWriter, r *http.Request)` — Readiness check
- `func handleLive(w http.ResponseWriter, r *http.Request)` — Liveness check
- `func gracefulShutdown(srv *http.Server)` — Graceful shutdown handler

**cmd/mcp-proxy/main.go:**
- `func main()` — MCP proxy entry point; loads config, initializes MCP proxy, starts stdio server
- `func setupMCPProxy(cfg *config.Config, deps *Dependencies) *mcp.MCPProxy` — Configures MCP proxy with auth, budget, guardian middleware

**cmd/manager/main.go:**
- `func main()` — Management API entry point
- `func setupAPIRouter(cfg *config.Config, deps *Dependencies) http.Handler` — Configures management API routes

**internal/core/config/config.go:**
- `func Load() *Config` — Loads configuration from file + environment
- `func (c *Config) Validate() error` — Validates configuration

**internal/components/auth/gateway.go:**
- `func NewAuthGateway(keyStore KeyStore, cache Cache, identityMapper IdentityMapper) *AuthGateway` — Constructor
- `func (g *AuthGateway) Authenticate(ctx context.Context, apiKey string) (*models.Identity, error)` — Validates API key and returns identity
- `func (g *AuthGateway) Middleware(next http.Handler) http.Handler` — HTTP middleware for API key auth

**internal/components/auth/keygen.go:**
- `func GenerateAPIKey() (string, error)` — Generates `hk_` prefixed API key
- `func HashAPIKey(key string) string` — SHA-256 hash of API key
- `func ValidateAPIKeyFormat(key string) bool` — Validates key format

**internal/components/budget/enforcer.go:**
- `func NewBudgetEnforcer(store BudgetStore, cache Cache, alert AlertSender) *BudgetEnforcer` — Constructor
- `func (e *BudgetEnforcer) Check(ctx context.Context, identity *models.Identity, estimatedCost float64) error` — Checks budget before request
- `func (e *BudgetEnforcer) RecordUsage(ctx context.Context, identity *models.Identity, cost float64, tokens int) error` — Records usage after request
- `func (e *BudgetEnforcer) Middleware(next http.Handler) http.Handler` — HTTP middleware for budget enforcement

**internal/components/budget/redis_store.go:**
- `func NewRedisBudgetStore(client *redis.Client) *RedisBudgetStore` — Constructor
- `func (s *RedisBudgetStore) GetBudget(ctx context.Context, identity *models.Identity) (*models.Budget, error)` — Gets budget from Redis/PostgreSQL
- `func (s *RedisBudgetStore) IncrementUsage(ctx context.Context, identity *models.Identity, cost float64, tokens int) error` — Atomic increment via Lua script

**internal/components/guardian/guardian.go:**
- `func NewGuardian(injectionDetector InjectionDetector, piiRedactor PIIRedactor, jailbreakDetector JailbreakDetector) *Guardian` — Constructor
- `func (g *Guardian) ScanRequest(ctx context.Context, req *models.ChatRequest) (*models.SecurityScanResult, error)` — Scans request for threats
- `func (g *Guardian) ScanResponse(ctx context.Context, response string) (*models.SecurityScanResult, error)` — Scans response for exfiltration
- `func (g *Guardian) Middleware(next http.Handler) http.Handler` — HTTP middleware for security scanning

**internal/components/guardian/patterns.go:**
- `func DetectInjection(ctx context.Context, messages []models.Message) (*InjectionResult, bool)` — Detects prompt injection patterns
- `func DetectJailbreak(ctx context.Context, messages []models.Message) (*JailbreakResult, bool)` — Detects jailbreak patterns
- `func DetectToolEscalation(ctx context.Context, req *models.ChatRequest) (*EscalationResult, bool)` — Detects tool escalation attempts

**internal/components/guardian/pii.go:**
- `func NewPIIRedactor() *PIIRedactor` — Constructor
- `func (r *PIIRedactor) Redact(ctx context.Context, messages []models.Message) ([]models.Message, []PIIFinding)` — Redacts PII from messages
- `func (r *PIIRedactor) RedactResponse(ctx context.Context, response string) (string, []PIIFinding)` — Redacts PII from response

**internal/components/policy/engine.go:**
- `func NewPolicyEngine(loader PolicyLoader) *PolicyEngine` — Constructor
- `func (e *PolicyEngine) Evaluate(ctx context.Context, req *models.ChatRequest, identity *models.Identity) (*PolicyResult, error)` — Evaluates all rules
- `func (e *PolicyEngine) Middleware(next http.Handler) http.Handler` — HTTP middleware for policy enforcement

**internal/components/policy/loader.go:**
- `func NewFileLoader(path string) *FileLoader` — Constructor
- `func (l *FileLoader) Load() (*models.Policy, error)` — Loads policy from YAML
- `func (l *FileLoader) Watch(ctx context.Context, onChange func(*models.Policy))` — Hot-reload watcher

**internal/components/router/router.go:**
- `func NewModelRouter(providers map[string]interfaces.LLMProvider, costCache Cache) *ModelRouter` — Constructor
- `func (r *ModelRouter) Route(ctx context.Context, req *models.ChatRequest) (*RoutingDecision, error)` — Routes request to best provider
- `func (r *ModelRouter) scoreProviders(ctx context.Context, req *models.ChatRequest, prefs *Preferences) []*ProviderScore` — Scores available providers

**internal/components/optimizer/optimizer.go:**
- `func NewPromptOptimizer(compressor Compressor, schemaEnforcer SchemaEnforcer, tracker EffectivenessTracker) *PromptOptimizer` — Constructor
- `func (o *PromptOptimizer) Optimize(ctx context.Context, prompt string, opts *Options) (*OptimizationResult, error)` — Optimizes prompt with safeguards
- `func (o *PromptOptimizer) validateSemantics(ctx context.Context, original, optimized string) bool` — Validates semantic preservation

**internal/components/cache/cache.go:**
- `func NewResponseCache(store CacheStore, embedder Embedder, similarity float64) *ResponseCache` — Constructor
- `func (c *ResponseCache) Get(ctx context.Context, req *models.ChatRequest) (*CachedResponse, error)` — Gets cached response
- `func (c *ResponseCache) Set(ctx context.Context, req *models.ChatRequest, resp *models.ChatResponse) error` — Stores response

**internal/adapters/openai/provider.go:**
- `func NewOpenAIProvider(apiKey string, baseURL string) *OpenAIProvider` — Constructor
- `func (p *OpenAIProvider) ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error)` — Calls OpenAI API
- `func (p *OpenAIProvider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error)` — Streams from OpenAI
- `func (p *OpenAIProvider) Name() string` — Returns provider name
- `func (p *OpenAIProvider) HealthCheck(ctx context.Context) error` — Health check
- `func (p *OpenAIProvider) EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error)` — Cost estimation

**internal/adapters/anthropic/provider.go:**
- `func NewAnthropicProvider(apiKey string, baseURL string) *AnthropicProvider` — Constructor
- `func (p *AnthropicProvider) ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error)` — Calls Anthropic API
- `func (p *AnthropicProvider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error)` — Streams from Anthropic
- `func (p *AnthropicProvider) Name() string` — Returns provider name
- `func (p *AnthropicProvider) HealthCheck(ctx context.Context) error` — Health check
- `func (p *AnthropicProvider) EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error)` — Cost estimation

**internal/adapters/mcp/proxy.go:**
- `func NewMCPProxy(cfg *config.Config, deps *Dependencies) *MCPProxy` — Constructor
- `func (p *MCPProxy) ServeStdio() error` — Starts MCP stdio server
- `func (p *MCPProxy) handleInitialize(req *mcp.InitializeRequest) (*mcp.InitializeResponse, error)` — MCP initialize handler
- `func (p *MCPProxy) handleToolsList(req *mcp.ListToolsRequest) (*mcp.ListToolsResponse, error)` — MCP tools list handler
- `func (p *MCPProxy) handleToolsCall(req *mcp.CallToolRequest) (*mcp.CallToolResponse, error)` — MCP tool call handler

**internal/api/server.go:**
- `func NewServer(cfg *config.Config, deps *Dependencies) *Server` — Constructor
- `func (s *Server) Start() error` — Starts HTTP server
- `func (s *Server) Shutdown(ctx context.Context) error` — Graceful shutdown

**internal/api/routes/users.go:**
- `func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request)` — GET /api/v1/users
- `func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request)` — POST /api/v1/users
- `func (s *Server) handleGetUser(w http.ResponseWriter, r *http.Request)` — GET /api/v1/users/:id
- `func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request)` — PUT /api/v1/users/:id
- `func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request)` — DELETE /api/v1/users/:id

**internal/api/routes/keys.go:**
- `func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request)` — GET /api/v1/users/:id/keys
- `func (s *Server) handleCreateKey(w http.ResponseWriter, r *http.Request)` — POST /api/v1/users/:id/keys
- `func (s *Server) handleRevokeKey(w http.ResponseWriter, r *http.Request)` — POST /api/v1/users/:id/keys/:key_id/revoke

**internal/api/routes/budget.go:**
- `func (s *Server) handleGetBudget(w http.ResponseWriter, r *http.Request)` — GET /api/v1/users/:id/budget
- `func (s *Server) handleSetBudget(w http.ResponseWriter, r *http.Request)` — PUT /api/v1/users/:id/budget
- `func (s *Server) handleGetUsage(w http.ResponseWriter, r *http.Request)` — GET /api/v1/budget/usage

**internal/api/routes/policies.go:**
- `func (s *Server) handleListPolicies(w http.ResponseWriter, r *http.Request)` — GET /api/v1/policies
- `func (s *Server) handleCreatePolicy(w http.ResponseWriter, r *http.Request)` — POST /api/v1/policies
- `func (s *Server) handleUpdatePolicy(w http.ResponseWriter, r *http.Request)` — PUT /api/v1/policies/:id
- `func (s *Server) handleActivatePolicy(w http.ResponseWriter, r *http.Request)` — POST /api/v1/policies/:id/activate

**internal/api/routes/audit.go:**
- `func (s *Server) handleListAuditEvents(w http.ResponseWriter, r *http.Request)` — GET /api/v1/audit/events
- `func (s *Server) handleExportAudit(w http.ResponseWriter, r *http.Request)` — GET /api/v1/audit/export
- `func (s *Server) handleVerifyAudit(w http.ResponseWriter, r *http.Request)` — GET /api/v1/audit/verify

**internal/observability/metrics/metrics.go:**
- `func NewMetricsCollector() *MetricsCollector` — Constructor
- `func (m *MetricsCollector) RecordRequest(provider, model, status string, duration time.Duration)` — Records request metrics
- `func (m *MetricsCollector) RecordTokens(provider, model, tokenType string, count int)` — Records token metrics
- `func (m *MetricsCollector) RecordCost(userID, teamID, provider string, cost float64)` — Records cost metrics
- `func (m *MetricsCollector) RecordThreat(threatType string, severity string)` — Records threat metrics
- `func (m *MetricsCollector) Handler() http.Handler` — Prometheus metrics endpoint

**internal/observability/audit/logger.go:**
- `func NewAuditLogger(sinks []AuditSink) *AuditLogger` — Constructor
- `func (l *AuditLogger) Log(ctx context.Context, event *models.AuditEvent) error` — Logs audit event
- `func (l *AuditLogger) Flush(ctx context.Context) error` — Flushes buffered events
- `func (l *AuditLogger) VerifyChain() (bool, error)` — Verifies hash-chain integrity

**internal/observability/audit/hashchain.go:**
- `func ComputeHash(event *models.AuditEvent) string` — Computes SHA-256 hash of event
- `func VerifyHash(event *models.AuditEvent) bool` — Verifies event hash

**internal/web/src/main.tsx:**
- `function main()` — React entry point; mounts App component

**internal/web/src/App.tsx:**
- `function App()` — Root component with React Router routes for all dashboard pages

**internal/web/src/api.ts:**
- `function apiFetch<T>(path: string, options?: RequestInit): Promise<T>` — Typed fetch wrapper with auth token
- `function getUsers(): Promise<User[]>` — Fetches user list
- `function getUsage(): Promise<UsageData>` — Fetches usage analytics
- `function getBudget(userId: string): Promise<Budget>` — Fetches user budget
- `function getAuditEvents(params: AuditQuery): Promise<AuditEvent[]>` — Fetches audit events

**internal/web/src/pages/Overview.tsx:**
- `function Overview()` — Real-time usage, cost, and alerts dashboard

**internal/web/src/pages/Usage.tsx:**
- `function Usage()` — Per-user, per-team, per-model analytics with charts

**internal/web/src/pages/Budget.tsx:**
- `function Budget()` — Budget tracking, setting, and alert management

**internal/web/src/pages/Policies.tsx:**
- `function Policies()` — Policy editor with YAML validation and testing

**internal/web/src/pages/AuditLog.tsx:**
- `function AuditLog()` — Audit log viewer with search, filter, and export

**internal/web/src/pages/Admin.tsx:**
- `function Admin()` — User management, API keys, and SSO configuration

## [Classes]

Define all new Go types, structs, and their methods.

### New Structs

**AuthGateway** (`internal/components/auth/gateway.go`):
- Fields: `keyStore KeyStore`, `cache Cache`, `identityMapper IdentityMapper`
- Methods: `Authenticate`, `Middleware`
- Implements: `http.Handler` middleware pattern

**BudgetEnforcer** (`internal/components/budget/enforcer.go`):
- Fields: `store BudgetStore`, `cache Cache`, `alert AlertSender`
- Methods: `Check`, `RecordUsage`, `Middleware`
- Uses Redis Lua scripts for atomic budget operations

**Guardian** (`internal/components/guardian/guardian.go`):
- Fields: `injectionDetector InjectionDetector`, `piiRedactor PIIRedactor`, `jailbreakDetector JailbreakDetector`, `outputSanitizer OutputSanitizer`
- Methods: `ScanRequest`, `ScanResponse`, `Middleware`
- Implements: Security scanning for both requests and responses

**PolicyEngine** (`internal/components/policy/engine.go`):
- Fields: `loader PolicyLoader`, `rules []models.Rule`, `mu sync.RWMutex`
- Methods: `Evaluate`, `Middleware`, `Reload`
- Implements: Rule evaluation with priority ordering

**ModelRouter** (`internal/components/router/router.go`):
- Fields: `providers map[string]interfaces.LLMProvider`, `costCache Cache`, `metrics MetricsCollector`
- Methods: `Route`, `scoreProviders`, `isAvailable`
- Implements: Cost/performance-based provider selection with fallback

**PromptOptimizer** (`internal/components/optimizer/optimizer.go`):
- Fields: `compressor Compressor`, `schemaEnforcer SchemaEnforcer`, `tracker EffectivenessTracker`, `shadowMode bool`
- Methods: `Optimize`, `validateSemantics`
- Implements: Prompt compression with shadow mode and rollback

**ResponseCache** (`internal/components/cache/cache.go`):
- Fields: `store CacheStore`, `embedder Embedder`, `similarity float64`, `encryptor Encryptor`
- Methods: `Get`, `Set`, `exactKey`, `calculateTTL`
- Implements: Semantic + exact match caching

**OpenAIProvider** (`internal/adapters/openai/provider.go`):
- Fields: `apiKey string`, `baseURL string`, `httpClient *http.Client`
- Methods: `ChatCompletion`, `ChatCompletionStream`, `Name`, `HealthCheck`, `EstimateCost`
- Implements: `interfaces.LLMProvider`

**AnthropicProvider** (`internal/adapters/anthropic/provider.go`):
- Fields: `apiKey string`, `baseURL string`, `httpClient *http.Client`
- Methods: `ChatCompletion`, `ChatCompletionStream`, `Name`, `HealthCheck`, `EstimateCost`
- Implements: `interfaces.LLMProvider`

**MCPProxy** (`internal/adapters/mcp/proxy.go`):
- Fields: `cfg *config.Config`, `deps *Dependencies`, `upstreamURL string`
- Methods: `ServeStdio`, `handleInitialize`, `handleToolsList`, `handleToolsCall`
- Implements: MCP stdio server that proxies to upstream MCP servers

**Server** (`internal/api/server.go`):
- Fields: `cfg *config.Config`, `deps *Dependencies`, `router http.Handler`
- Methods: `Start`, `Shutdown`, `setupRoutes`
- Implements: Management REST API

**MetricsCollector** (`internal/observability/metrics/metrics.go`):
- Fields: `requestsTotal *prometheus.CounterVec`, `requestDuration *prometheus.HistogramVec`, `tokensTotal *prometheus.CounterVec`, `costTotal *prometheus.CounterVec`, `threatsDetected *prometheus.CounterVec`
- Methods: `RecordRequest`, `RecordTokens`, `RecordCost`, `RecordThreat`, `Handler`
- Implements: Prometheus metrics collection

**AuditLogger** (`internal/observability/audit/logger.go`):
- Fields: `sinks []AuditSink`, `buffer chan *models.AuditEvent`, `mu sync.Mutex`
- Methods: `Log`, `Flush`, `VerifyChain`
- Implements: `interfaces.AuditLogger` with hash-chain immutability

## [Dependencies]

Add the following Go dependencies to the project.

### Go Modules

| Package | Version | Purpose |
|---------|---------|---------|
| `github.com/go-chi/chi/v5` | v5.x | HTTP router for proxy and management API |
| `github.com/spf13/viper` | v1.x | Configuration management (YAML + env) |
| `github.com/redis/go-redis/v9` | v9.x | Redis client for caching and budget store |
| `github.com/jackc/pgx/v5` | v5.x | PostgreSQL driver for audit and user data |
| `github.com/prometheus/client_golang` | v1.x | Prometheus metrics exporter |
| `github.com/google/uuid` | v1.x | UUID generation for IDs |
| `golang.org/x/crypto` | latest | Crypto utilities (SHA-256, key hashing) |
| `github.com/stretchr/testify` | v1.x | Testing framework |
| `github.com/golang-jwt/jwt/v5` | v5.x | JWT for management API auth |
| `github.com/rs/cors` | v1.x | CORS middleware |
| `github.com/sashabaranov/go-openai` | v1.x | OpenAI API client |
| `github.com/anthropics/anthropic-sdk-go` | v1.x | Anthropic API client |
| `github.com/mark3labs/mcp-go` | v1.x | MCP protocol implementation |
| `go.uber.org/zap` | v1.x | Structured logging |

### Infrastructure Services (Docker Compose)

| Service | Version | Purpose |
|---------|---------|---------|
| PostgreSQL | 16-alpine | User data, budgets, audit events |
| Redis | 7.2-alpine | Caching, rate limiting, budget counters |
| Prometheus | latest | Metrics collection |
| Grafana | latest | Dashboard visualization |

## [Testing]

Implement comprehensive testing across all components.

### Test Files

**Unit Tests:**
- `internal/components/auth/gateway_test.go` — Auth gateway validation, key revocation, caching
- `internal/components/budget/enforcer_test.go` — Budget checks, soft/hard limits, atomic operations
- `internal/components/guardian/guardian_test.go` — Injection detection, PII redaction, jailbreak detection
- `internal/components/policy/engine_test.go` — Rule evaluation, priority ordering, hot-reload
- `internal/components/router/router_test.go` — Provider scoring, fallback logic
- `internal/components/optimizer/optimizer_test.go` — Compression, semantic validation, shadow mode
- `internal/components/cache/cache_test.go` — Exact/semantic matching, TTL, encryption
- `internal/adapters/openai/provider_test.go` — Request/response mapping, error handling
- `internal/adapters/anthropic/provider_test.go` — Request/response mapping, error handling
- `internal/observability/audit/hashchain_test.go` — Hash-chain integrity, tamper detection

**Integration Tests:**
- `tests/integration/proxy_test.go` — Full proxy flow: auth → budget → guardian → provider
- `tests/integration/streaming_test.go` — SSE streaming end-to-end

**E2E Tests:**
- `tests/e2e/full_flow_test.go` — Complete flow with real infrastructure (Docker Compose)

### Validation Strategy

- **Performance benchmarks**: `go test -bench=.` for all hot paths (auth, budget, guardian)
- **Load testing**: `hey` or `wrk` for 1000+ concurrent requests
- **Security testing**: Test injection patterns, PII redaction accuracy, jailbreak detection
- **Coverage**: Target >90% unit test coverage, >80% integration coverage

## [Implementation Order]

Implement the Management Harness in the following sequence to minimize conflicts and ensure successful integration.

1. **Project scaffolding** — Create go.mod, Makefile, Dockerfile, docker-compose.yml, .env.example, .gitignore, README.md
2. **Core models and interfaces** — Define all DTOs in `internal/core/models/` and interfaces in `internal/core/interfaces/`
3. **Configuration** — Implement `internal/core/config/config.go` with Viper
4. **Observability foundation** — Implement `internal/observability/metrics/metrics.go` and `internal/observability/audit/` (logger + hashchain)
5. **Auth component** — Implement `internal/components/auth/` (gateway, keygen) with unit tests
6. **Budget component** — Implement `internal/components/budget/` (enforcer, redis_store) with unit tests
7. **Guardian component** — Implement `internal/components/guardian/` (guardian, patterns, pii) with unit tests
8. **Provider adapters** — Implement `internal/adapters/openai/` and `internal/adapters/anthropic/` with unit tests
9. **Proxy server** — Implement `cmd/proxy/main.go` with HTTP endpoints, middleware chain, and SSE streaming
10. **MCP proxy** — Implement `cmd/mcp-proxy/main.go` and `internal/adapters/mcp/proxy.go` for MCP stdio transport
11. **Policy engine** — Implement `internal/components/policy/` (engine, loader) with unit tests
12. **Model router** — Implement `internal/components/router/` with unit tests
13. **Response cache** — Implement `internal/components/cache/` with unit tests
14. **Prompt optimizer** — Implement `internal/components/optimizer/` with unit tests
15. **Management API** — Implement `internal/api/` (server, routes, middleware)
16. **Web dashboard** — Implement `internal/web/` React dashboard (Vite + TypeScript + Tailwind)
17. **Deployment manifests** — Create `deployments/k8s/` and `deployments/terraform/` infrastructure as code
18. **Integration tests** — Implement `tests/integration/` and `tests/e2e/`
19. **Documentation** — Write README, OpenAPI spec, and integration guides for Claude Desktop, Claude Code, Cursor, Cline
20. **Final validation** — Run full test suite, load tests, and security validation
