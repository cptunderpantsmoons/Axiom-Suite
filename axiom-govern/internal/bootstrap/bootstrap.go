// Package bootstrap wires the Management Harness components together.
package bootstrap

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"github.com/laiw/management-harness/internal/adapters/anthropic"
	"github.com/laiw/management-harness/internal/adapters/openai"
	"github.com/laiw/management-harness/internal/components/circuitbreaker"
	"github.com/laiw/management-harness/internal/components/auth"
	"github.com/laiw/management-harness/internal/components/budget"
	"github.com/laiw/management-harness/internal/components/cache"
	"github.com/laiw/management-harness/internal/components/guardian"
	"github.com/laiw/management-harness/internal/components/optimizer"
	"github.com/laiw/management-harness/internal/components/policy"
	"github.com/laiw/management-harness/internal/components/provenance"
	"github.com/laiw/management-harness/internal/components/router"
	"github.com/laiw/management-harness/internal/components/skills"
	"github.com/laiw/management-harness/internal/core/config"
	"github.com/laiw/management-harness/internal/core/deps"
	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
	"github.com/laiw/management-harness/internal/core/providers"
	"github.com/laiw/management-harness/internal/observability/audit"
	"github.com/laiw/management-harness/internal/observability/metrics"
	"github.com/laiw/management-harness/internal/observability/savings"
	"github.com/laiw/management-harness/internal/core/pricing"
	"github.com/redis/go-redis/v9"
)

// Build constructs the full dependency graph for the Harness.
func Build(configFile string) (*deps.Dependencies, error) {
	cfg := config.Load(configFile)
	initLogger(cfg.Logging)

	zap.L().Info("bootstrapping Management Harness")

	metricsCollector := metrics.NewMetricsCollector()

	// Runtime settings (managed from the dashboard). They override static
	// config.yaml for runtime-mutable settings and are hot-reloaded for providers.
	runtimeStore := config.NewRuntimeStore(config.DefaultRuntimeSettingsPath())
	if err := runtimeStore.Load(); err != nil {
		zap.L().Warn("failed to load runtime settings", zap.Error(err))
	}
	if runtimeStore.Exists() {
		config.ApplyRuntime(cfg, runtimeStore.Get())
		if err := cfg.Validate(); err != nil {
			return nil, fmt.Errorf("invalid effective runtime configuration: %w", err)
		}
		zap.L().Info("runtime settings applied", zap.String("path", runtimeStore.Path()))
	}

	// Audit logging.
	sinks := []audit.AuditSink{audit.NewMemorySink()}
	if f := os.Getenv("MH_AUDIT_FILE"); f != "" {
		if s, err := audit.NewFileSink(f); err == nil {
			sinks = append(sinks, s)
		}
	} else {
		zap.L().Warn("no MH_AUDIT_FILE configured: audit events are kept only in memory and are lost on restart")
	}
	if os.Getenv("MH_AUDIT_CHAIN_FILE") == "" {
		zap.L().Warn("no MH_AUDIT_CHAIN_FILE configured: the audit hash chain is not persisted across restarts")
	}
	auditLogger := audit.NewAuditLogger(sinks)
	auditLogger.Start(context.Background())

	// Key + budget stores. When Redis is enabled, both are Redis-backed so the
	// proxy and manager share API keys, budgets, and usage across processes.
	var keyStore interfaces.KeyStore
	var budgetStore interfaces.BudgetStore
	var savingsStore savings.Store
	var redisClient *redis.Client
	if cfg.Redis.Enabled {
		redisClient = redis.NewClient(&redis.Options{Addr: cfg.Redis.Addr, Password: cfg.Redis.Password, DB: cfg.Redis.DB})
		keyStore = auth.NewRedisKeyStore(redisClient)
		budgetStore = budget.NewRedisBudgetStore(redisClient)
		savingsStore = savings.NewRedis(redisClient, "harness:optimizer:savings")
	} else {
		zap.L().Warn("redis disabled: API keys, budgets and usage counters use in-memory storage and will not survive restarts or be shared across processes")
		keyStore = auth.NewMemoryKeyStore()
		budgetStore = budget.NewMemoryBudgetStore()
		savingsStore = savings.NewMemory()
	}
	memCache := cache.NewMemoryCache()

	// Provider registry: static config.yaml merged with runtime overrides, built
	// into a concurrency-safe registry the proxy reads on every request.
	providerRegistry := providers.NewRegistry(buildProviders(cfg, runtimeStore, metricsCollector))
	if providerRegistry.Len() == 0 {
		// Always allow a no-op default so the proxy can start.
		zap.L().Warn("no providers configured; proxy will return 503 for completions")
	}

	// Hot-reload providers when the runtime settings file changes.
	runtimeStore.Watch(2*time.Second, func() {
		_ = runtimeStore.Load()
		providerRegistry.Replace(buildProviders(cfg, runtimeStore, metricsCollector))
		zap.L().Info("providers reloaded from runtime settings")
	})

	// Skills: reusable prompt contracts, file-backed + hot-reloaded.
	skillStore := skills.NewStore(skills.DefaultPath())
	if err := skillStore.Load(); err != nil {
		zap.L().Warn("failed to load skills", zap.Error(err))
	}
	skillRegistry := skills.NewRegistry(skillStore.Get())
	skillEngine := skills.NewEngine(skillRegistry)
	skillStore.Watch(2*time.Second, func() {
		_ = skillStore.Load()
		skillRegistry.Replace(skillStore.Get())
		zap.L().Info("skills reloaded from file")
	})

	authGateway := auth.NewAuthGateway(keyStore, memCache, nil)

	budgetEnforcer := budget.NewBudgetEnforcer(budgetStore, memCache, nil)
	guardianSvc := guardian.NewGuardian(nil, nil, nil).WithOptions(guardian.Options{
		BlockInjection: cfg.Guardian.BlockInjection,
		BlockJailbreak: cfg.Guardian.BlockJailbreak,
		RedactPII:      cfg.Guardian.RedactPII,
	})

	responseCache := cache.NewResponseCache(memCache, 0.98)
	modelRouter := router.NewModelRouter(providerRegistry, memCache)

	var policyEngine *policy.PolicyEngine
	policyCtx, policyCancel := context.WithCancel(context.Background())
	var policyWatch func(context.Context, func(*models.Policy))
	if redisClient != nil {
		loader := policy.NewRedisLoader(redisClient)
		policyEngine = policy.NewPolicyEngine(loader)
		policyWatch = loader.Watch
	} else if pf := getPolicyFile(); pf != "" {
		loader := policy.NewFileLoader(pf)
		policyEngine = policy.NewPolicyEngine(loader)
		policyWatch = loader.Watch
	} else {
		policyEngine = policy.NewPolicyEngine(nil)
	}
	if policyWatch != nil {
		go policyWatch(policyCtx, policyEngine.Reload)
	}

	promptOptimizer := buildOptimizer(cfg, providerRegistry)

	// Provenance: Proof of Source / Proof of Human.
	provSigner, provPub, err := provenance.LoadOrGenerateServerKey()
	if err != nil {
		zap.L().Warn("failed to initialise provenance signer", zap.Error(err))
	}
	if os.Getenv("MH_PROVENANCE_PRIVATE_KEY") == "" {
		zap.L().Warn("MH_PROVENANCE_PRIVATE_KEY unset: using ephemeral provenance key (resets on restart)")
	}

	return &deps.Dependencies{
		Config:       cfg,
		Metrics:      metricsCollector,
		Audit:        auditLogger,
		Auth:         authGateway,
		Budget:       budgetEnforcer,
		Guardian:     guardianSvc,
		Router:       modelRouter,
		Cache:        responseCache,
		PolicyEngine: policyEngine,
		Optimizer:    promptOptimizer,
		KeyStore:     keyStore,
		BudgetStore:  budgetStore,
		Providers:    providerRegistry,
		RuntimeStore: runtimeStore,
		Skills:       skillRegistry,
		SkillEngine:  skillEngine,
		SkillStore:   skillStore,
		Savings:      savingsStore,
		Pricing:      pricing.Build(pricing.Default(), effectiveProviderConfigs(cfg, runtimeStore)),
		ProvenanceSigner:    provSigner,
		ProvenancePublicKey: provPub,
		RedisClient:         redisClient,
		PolicyStop:          policyCancel,
	}, nil
}

func getPolicyFile() string {
	candidates := []string{"./configs/policies/default.yaml", "/etc/management-harness/policies/default.yaml"}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

// buildProviders resolves the effective provider set (static config.yaml merged
// with any runtime overrides) and wraps each in a circuit breaker.
func buildProviders(cfg *config.Config, rt *config.RuntimeStore, mc *metrics.MetricsCollector) map[string]interfaces.LLMProvider {
	return wrapProviders(effectiveProviderConfigs(cfg, rt), cfg.Breaker, mc)
}

// effectiveProviderConfigs returns the static provider config overlaid with any
// runtime (dashboard) provider overrides.
func effectiveProviderConfigs(cfg *config.Config, rt *config.RuntimeStore) map[string]config.ProviderConfig {
	if rt != nil && rt.Exists() {
		if ov := rt.Get().Providers; ov != nil {
			return config.MergeProviders(cfg.Providers, ov)
		}
	}
	return cfg.Providers
}

// wrapProviders builds breaker-wrapped LLM providers from a provider config map.
func wrapProviders(configs map[string]config.ProviderConfig, globalBreaker config.BreakerConfig, mc *metrics.MetricsCollector) map[string]interfaces.LLMProvider {
	out := make(map[string]interfaces.LLMProvider, len(configs))
	for name, pc := range configs {
		if !pc.Enabled {
			continue
		}
		var base interfaces.LLMProvider
		switch pc.Type {
		case "anthropic":
			base = anthropic.NewProvider(pc.APIKey, pc.BaseURL)
		case "local":
			// Self-hosted inference (vLLM / llama.cpp / custom) — OpenAI-compatible.
			base = openai.NewProvider(name, pc.APIKey, pc.BaseURL)
		default:
			base = openai.NewProvider(name, pc.APIKey, pc.BaseURL)
		}
		bf := globalBreaker.MaxFailures
		if pc.Breaker.MaxFailures > 0 {
			bf = pc.Breaker.MaxFailures
		}
		cd := globalBreaker.Cooldown
		if pc.Breaker.Cooldown > 0 {
			cd = pc.Breaker.Cooldown
		}
		out[name] = circuitbreaker.Wrap(name, base, circuitbreaker.Config{MaxFailures: bf, Cooldown: cd}, func(p string, s circuitbreaker.State) {
			mc.SetBreakerState(p, int(s))
		})
	}
	return out
}

// buildOptimizer returns the prompt optimizer. When an LLM provider is
// configured (optimizer.enabled + provider + model), it uses that provider's
// model for lossy rewrite/compression (optionally in shadow mode); otherwise it
// falls back to the lossless whitespace normaliser. It is only invoked for
// skills that opt in (skill.Optimize).
func buildOptimizer(cfg *config.Config, reg *providers.Registry) *optimizer.PromptOptimizer {
	if cfg.Optimizer.Enabled && cfg.Optimizer.Provider != "" && cfg.Optimizer.Model != "" {
		if prov, ok := reg.Snapshot()[cfg.Optimizer.Provider]; ok {
			zap.L().Info("using LLM prompt optimiser",
				zap.String("provider", cfg.Optimizer.Provider),
				zap.String("model", cfg.Optimizer.Model),
				zap.Bool("shadow", cfg.Optimizer.ShadowMode))
			return optimizer.NewPromptOptimizer(optimizer.NewLLMCompressor(prov, cfg.Optimizer.Model), nil, nil).
				WithShadowMode(cfg.Optimizer.ShadowMode)
		}
	}
	return optimizer.NewPromptOptimizer(nil, nil, nil).WithShadowMode(false)
}

func initLogger(lc config.LoggingConfig) {
	level := zapcore.InfoLevel
	if err := level.UnmarshalText([]byte(lc.Level)); err != nil {
		level = zapcore.InfoLevel
	}
	encCfg := zap.NewProductionEncoderConfig()
	encCfg.EncodeTime = zapcore.ISO8601TimeEncoder
	var encoder zapcore.Encoder
	if lc.Format == "console" {
		encoder = zapcore.NewConsoleEncoder(encCfg)
	} else {
		encoder = zapcore.NewJSONEncoder(encCfg)
	}
	core := zapcore.NewCore(encoder, zapcore.Lock(os.Stdout), level)
	logger := zap.New(core, zap.AddCaller())
	zap.ReplaceGlobals(logger)
}

// Shutdown releases resources held by the dependency graph.
func Shutdown(d *deps.Dependencies) {
	if d == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if d.Audit != nil {
		_ = d.Audit.Flush(ctx)
		_ = d.Audit.Close()
	}
	if d.PolicyStop != nil {
		d.PolicyStop()
	}
	if d.RuntimeStore != nil {
		d.RuntimeStore.Stop()
	}
	if d.SkillStore != nil {
		d.SkillStore.Stop()
	}
	if d.RedisClient != nil {
		_ = d.RedisClient.Close()
	}
}
