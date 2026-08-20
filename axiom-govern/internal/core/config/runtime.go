// Package config loads and validates Management Harness configuration.
package config

import (
	"encoding/json"
	"os"
	"sync"
	"time"
)

// ProviderOverride is a runtime-mutable provider definition managed from the
// dashboard. It is persisted separately so a running gateway can hot-reload
// providers without touching config.yaml.
type ProviderOverride struct {
	Type        string `json:"type"`
	BaseURL     string `json:"base_url"`
	APIKey      string `json:"api_key,omitempty"`
	Enabled     bool   `json:"enabled"`
	MaxFailures int    `json:"max_failures,omitempty"`
	Cooldown    string `json:"cooldown,omitempty"` // duration string, e.g. "10s"
	Local       LocalProviderConfig `json:"local,omitempty"` // GPU-hour cost for type: local
}

// RuntimeManager holds manager secrets that may be rotated from the dashboard.
type RuntimeManager struct {
	AdminToken string `json:"admin_token,omitempty"`
	JWTSecret  string `json:"jwt_secret,omitempty"`
}

// RuntimeGuardian mirrors GuardianConfig with JSON snake_case tag names.
type RuntimeGuardian struct {
	Enabled        bool `json:"enabled"`
	BlockInjection bool `json:"block_injection"`
	BlockJailbreak bool `json:"block_jailbreak"`
	RedactPII      bool `json:"redact_pii"`
}

// RuntimePricing mirrors PricingConfig.
type RuntimePricing struct {
	DefaultRate float64 `json:"default_rate"`
}

// RuntimeBreaker mirrors BreakerConfig with a string duration.
type RuntimeBreaker struct {
	MaxFailures int    `json:"max_failures"`
	Cooldown    string `json:"cooldown,omitempty"`
}

// RuntimeProxy mirrors the mutable ProxyConfig fields.
type RuntimeProxy struct {
	Enabled         bool   `json:"enabled"`
	DefaultProvider string `json:"default_provider"`
	RequireAuth     bool   `json:"require_auth"`
	UpstreamTimeout string `json:"upstream_timeout,omitempty"`
	MaxRequestBytes int    `json:"max_request_bytes"`
}

// RuntimeMetrics mirrors MetricsConfig.
type RuntimeMetrics struct {
	Enabled bool   `json:"enabled"`
	Port    int    `json:"port"`
	Path    string `json:"path"`
}

// RuntimeRedis mirrors RedisConfig.
type RuntimeRedis struct {
	Enabled  bool   `json:"enabled"`
	Addr     string `json:"addr"`
	Password string `json:"password,omitempty"`
	DB       int    `json:"db"`
}

// RuntimeOptimizer mirrors OptimizerConfig (prompt-optimisation / skill wizard
// LLM), editable from the dashboard.
type RuntimeOptimizer struct {
	Enabled    bool   `json:"enabled"`
	Provider   string `json:"provider,omitempty"`
	Model      string `json:"model,omitempty"`
	ShadowMode bool   `json:"shadow_mode"`
}

// RuntimeSettings is the set of settings that may be mutated at runtime and
// persisted to MH_RUNTIME_CONFIG (a JSON file). It is applied on top of the
// static config.yaml at startup, and providers are additionally hot-reloaded.
//
// The optional sections are pointers: a nil section means "not provided — keep
// the current value", so a partial update (e.g. providers only) never clobbers
// other settings. The dashboard always sends the full object.
type RuntimeSettings struct {
	Providers map[string]ProviderOverride `json:"providers,omitempty"`
	Guardian  *RuntimeGuardian            `json:"guardian,omitempty"`
	Pricing   *RuntimePricing             `json:"pricing,omitempty"`
	Breaker   *RuntimeBreaker             `json:"breaker,omitempty"`
	Proxy     *RuntimeProxy               `json:"proxy,omitempty"`
	Metrics   *RuntimeMetrics             `json:"metrics,omitempty"`
	Manager   *RuntimeManager             `json:"manager,omitempty"`
	Redis     *RuntimeRedis               `json:"redis,omitempty"`
	Optimizer *RuntimeOptimizer           `json:"optimizer,omitempty"`
}

// DefaultRuntimeSettingsPath returns the runtime settings file path, honoring
// the MH_RUNTIME_CONFIG environment override.
func DefaultRuntimeSettingsPath() string {
	if p := os.Getenv("MH_RUNTIME_CONFIG"); p != "" {
		return p
	}
	return "configs/runtime.json"
}

// RuntimeStore persists RuntimeSettings to a JSON file and exposes thread-safe
// load/save plus a change signature for hot-reload watches.
type RuntimeStore struct {
	mu       sync.RWMutex
	path     string
	data     RuntimeSettings
	exists   bool
	stopCh   chan struct{}
	stopOnce sync.Once
}

// NewRuntimeStore constructs a store for the given file path.
func NewRuntimeStore(path string) *RuntimeStore {
	return &RuntimeStore{path: path, stopCh: make(chan struct{})}
}

// Path returns the backing file path.
func (s *RuntimeStore) Path() string { return s.path }

// Load reads the store from disk. A missing file is not an error.
func (s *RuntimeStore) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			s.data = RuntimeSettings{}
			s.exists = false
			return nil
		}
		return err
	}
	if err := json.Unmarshal(b, &s.data); err != nil {
		return err
	}
	s.exists = true
	return nil
}

// Get returns a defensive copy of the current settings.
func (s *RuntimeStore) Get() RuntimeSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneSettings(s.data)
}

// Exists reports whether a persisted file was loaded.
func (s *RuntimeStore) Exists() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.exists
}

// Save persists the supplied settings, merging to preserve secrets (an empty
// incoming secret retains the prior value) and any nil optional section. See
// mergeSettings.
func (s *RuntimeStore) Save(rs RuntimeSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	merged := mergeSettings(s.data, rs)
	b, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(s.path, b, 0o600); err != nil {
		return err
	}
	s.data = merged
	s.exists = true
	return nil
}

// Signature returns a cheap fingerprint of the on-disk file used by watchers.
func (s *RuntimeStore) Signature() (size int64, mod time.Time, exists bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	fi, err := os.Stat(s.path)
	if err != nil {
		return 0, time.Time{}, false
	}
	return fi.Size(), fi.ModTime(), true
}

// Watch polls the backing file for changes and invokes onReload when its
// signature changes. Stop terminates the watcher.
func (s *RuntimeStore) Watch(interval time.Duration, onReload func()) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		var lastSize int64
		var lastMod time.Time
		var lastExists bool
		for {
			select {
			case <-ticker.C:
				size, mod, exists := s.Signature()
				if size != lastSize || !mod.Equal(lastMod) || exists != lastExists {
					lastSize, lastMod, lastExists = size, mod, exists
					onReload()
				}
			case <-s.stopCh:
				return
			}
		}
	}()
}

// Stop terminates the watcher goroutine (if any). Safe to call multiple times.
func (s *RuntimeStore) Stop() {
	s.stopOnce.Do(func() { close(s.stopCh) })
}

// ApplyRuntime overlays runtime-mutable settings onto the static config. Called
// once at startup (before serving). A nil section means "keep static value";
// otherwise the section overrides, with empty secret fields also keeping the
// static value. Providers are NOT handled here — they are resolved separately
// so they can be hot-reloaded without touching the live config pointer.
func ApplyRuntime(cfg *Config, rt RuntimeSettings) {
	if rt.Guardian != nil {
		cfg.Guardian = GuardianConfig{
			Enabled:        rt.Guardian.Enabled,
			BlockInjection: rt.Guardian.BlockInjection,
			BlockJailbreak: rt.Guardian.BlockJailbreak,
			RedactPII:      rt.Guardian.RedactPII,
		}
	}
	if rt.Pricing != nil && rt.Pricing.DefaultRate > 0 {
		cfg.Pricing.DefaultRate = rt.Pricing.DefaultRate
	}
	if rt.Breaker != nil {
		if rt.Breaker.MaxFailures > 0 {
			cfg.Breaker.MaxFailures = rt.Breaker.MaxFailures
		}
		if d := parseDuration(rt.Breaker.Cooldown); d > 0 {
			cfg.Breaker.Cooldown = d
		}
	}
	if rt.Proxy != nil {
		cfg.Proxy.Enabled = rt.Proxy.Enabled
		if rt.Proxy.DefaultProvider != "" {
			cfg.Proxy.DefaultProvider = rt.Proxy.DefaultProvider
		}
		cfg.Proxy.RequireAuth = rt.Proxy.RequireAuth
		if d := parseDuration(rt.Proxy.UpstreamTimeout); d > 0 {
			cfg.Proxy.UpstreamTimeout = d
		}
		if rt.Proxy.MaxRequestBytes > 0 {
			cfg.Proxy.MaxRequestBytes = rt.Proxy.MaxRequestBytes
		}
	}
	if rt.Metrics != nil {
		// Keep the static port/path when blank (merge-on-blank) so a partial save
		// cannot silently disable the scrape endpoint.
		m := MetricsConfig{Enabled: rt.Metrics.Enabled, Path: rt.Metrics.Path}
		m.Port = cfg.Metrics.Port
		if rt.Metrics.Port > 0 {
			m.Port = rt.Metrics.Port
		}
		if m.Path == "" {
			m.Path = cfg.Metrics.Path
		}
		cfg.Metrics = m
	}
	if rt.Manager != nil {
		if rt.Manager.AdminToken != "" {
			cfg.Manager.AdminToken = rt.Manager.AdminToken
		}
		if rt.Manager.JWTSecret != "" {
			cfg.Manager.JWTSecret = rt.Manager.JWTSecret
		}
	}
	if rt.Redis != nil {
		cfg.Redis = RedisConfig{Enabled: rt.Redis.Enabled, Addr: rt.Redis.Addr, DB: rt.Redis.DB}
		if rt.Redis.Password != "" {
			cfg.Redis.Password = rt.Redis.Password
		}
	}
	if rt.Optimizer != nil {
		cfg.Optimizer = OptimizerConfig{
			Enabled:    rt.Optimizer.Enabled,
			Provider:   rt.Optimizer.Provider,
			Model:      rt.Optimizer.Model,
			ShadowMode: rt.Optimizer.ShadowMode,
		}
	}
}

// MergeProviders overlays runtime provider overrides onto the static provider
// config, yielding the effective provider set. Runtime overrides are
// authoritative per name; empty fields fall back to the static value so a
// partial dashboard save never silently clobbers a configured local GPU block.
func MergeProviders(static map[string]ProviderConfig, overrides map[string]ProviderOverride) map[string]ProviderConfig {
	// Start from the STATIC set so providers not touched by the dashboard are
	// never silently dropped.  Runtime overrides are then layered in per-name.
	out := make(map[string]ProviderConfig, len(static))
	for name, sp := range static {
		po, hasRO := overrides[name]
		pc := ProviderConfig{
			Type:    sp.Type,
			BaseURL: sp.BaseURL,
			APIKey:  sp.APIKey,
			Enabled: sp.Enabled,
			Breaker: BreakerConfig{MaxFailures: sp.Breaker.MaxFailures, Cooldown: sp.Breaker.Cooldown},
			Local:   sp.Local,
		}
		if hasRO {
			if po.Type != ""  { pc.Type    = po.Type }
			if po.BaseURL != "" { pc.BaseURL = po.BaseURL }
			if po.APIKey != ""  { pc.APIKey  = po.APIKey }
			pc.Enabled = po.Enabled
			if po.MaxFailures != 0 { pc.Breaker.MaxFailures = po.MaxFailures }
			if po.Cooldown != ""  { pc.Breaker.Cooldown   = parseDuration(po.Cooldown) }
			if !LocalConfigIsEmpty(po.Local) { pc.Local = po.Local }
		}
		out[name] = pc
	}
	return out
}

// localConfigIsEmpty reports whether every GPU-hour accounting field is zero,
// meaning the runtime override should not replace the static config's local
// provider pricing block.
func LocalConfigIsEmpty(l LocalProviderConfig) bool {
	return l.GPUHourCost == 0 && l.GPUCount == 0 && l.DeclaredThroughputTPS == 0 && l.SafetyFactor == 0 && l.MinGPUSecondsPerRequest == 0
}

func parseDuration(s string) time.Duration {
	if s == "" {
		return 0
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0
	}
	return d
}

// mergeSettings makes the incoming settings authoritative while preserving:
// (1) secret fields when the incoming value is empty (masked), and
// (2) entire optional sections when they are nil (not provided).
func mergeSettings(existing, incoming RuntimeSettings) RuntimeSettings {
	out := incoming
	if out.Providers == nil {
		out.Providers = map[string]ProviderOverride{}
	}
	for name, p := range out.Providers {
		if p.APIKey == "" {
			if ep, ok := existing.Providers[name]; ok && ep.APIKey != "" {
				p.APIKey = ep.APIKey
				out.Providers[name] = p
			}
		}
	}
	if out.Guardian == nil && existing.Guardian != nil {
		g := *existing.Guardian
		out.Guardian = &g
	}
	if out.Pricing == nil && existing.Pricing != nil {
		g := *existing.Pricing
		out.Pricing = &g
	}
	if out.Breaker == nil && existing.Breaker != nil {
		g := *existing.Breaker
		out.Breaker = &g
	}
	if out.Proxy == nil && existing.Proxy != nil {
		g := *existing.Proxy
		out.Proxy = &g
	}
	if out.Metrics == nil && existing.Metrics != nil {
		g := *existing.Metrics
		out.Metrics = &g
	}
	if out.Manager == nil {
		if existing.Manager != nil {
			g := *existing.Manager
			out.Manager = &g
		}
	} else {
		if out.Manager.AdminToken == "" && existing.Manager != nil {
			out.Manager.AdminToken = existing.Manager.AdminToken
		}
		if out.Manager.JWTSecret == "" && existing.Manager != nil {
			out.Manager.JWTSecret = existing.Manager.JWTSecret
		}
	}
	if out.Redis == nil {
		if existing.Redis != nil {
			g := *existing.Redis
			out.Redis = &g
		}
	} else if out.Redis.Password == "" && existing.Redis != nil {
		out.Redis.Password = existing.Redis.Password
	}
	if out.Optimizer == nil && existing.Optimizer != nil {
		g := *existing.Optimizer
		out.Optimizer = &g
	}
	return out
}

func cloneSettings(rs RuntimeSettings) RuntimeSettings {
	if rs.Providers != nil {
		m := make(map[string]ProviderOverride, len(rs.Providers))
		for k, v := range rs.Providers {
			m[k] = v
		}
		rs.Providers = m
	}
	if rs.Guardian != nil {
		g := *rs.Guardian
		rs.Guardian = &g
	}
	if rs.Pricing != nil {
		g := *rs.Pricing
		rs.Pricing = &g
	}
	if rs.Breaker != nil {
		g := *rs.Breaker
		rs.Breaker = &g
	}
	if rs.Proxy != nil {
		g := *rs.Proxy
		rs.Proxy = &g
	}
	if rs.Metrics != nil {
		g := *rs.Metrics
		rs.Metrics = &g
	}
	if rs.Manager != nil {
		g := *rs.Manager
		rs.Manager = &g
	}
	if rs.Redis != nil {
		g := *rs.Redis
		rs.Redis = &g
	}
	if rs.Optimizer != nil {
		g := *rs.Optimizer
		rs.Optimizer = &g
	}
	return rs
}