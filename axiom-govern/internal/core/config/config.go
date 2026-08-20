// Package config loads and validates Management Harness configuration.
package config

import (
	"fmt"
	"net/netip"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
)

// Config is the top-level configuration for the Management Harness.
type Config struct {
	Server    ServerConfig              `mapstructure:"server"`
	Proxy     ProxyConfig               `mapstructure:"proxy"`
	Manager   ManagerConfig             `mapstructure:"manager"`
	Redis     RedisConfig               `mapstructure:"redis"`
	Providers map[string]ProviderConfig `mapstructure:"providers"`
	Guardian  GuardianConfig            `mapstructure:"guardian"`
	Metrics   MetricsConfig             `mapstructure:"metrics"`
	Pricing   PricingConfig             `mapstructure:"pricing"`
	Breaker   BreakerConfig             `mapstructure:"breaker"`
	Optimizer OptimizerConfig           `mapstructure:"optimizer"`
	Logging   LoggingConfig             `mapstructure:"logging"`
}

// PricingConfig controls token-cost computation for the per-identity cost
// metric and budget-estimate reconciliation.
type PricingConfig struct {
	// DefaultRate is the conservative fallback USD cost per 1K tokens when a
	// model is not present in the built-in price table.
	DefaultRate float64 `mapstructure:"default_rate"`
}

// BreakerConfig tunes the per-provider circuit breaker. Values here are used
// unless a provider overrides them via ProviderConfig.Breaker.
type BreakerConfig struct {
	MaxFailures int           `mapstructure:"max_failures"`
	Cooldown    time.Duration `mapstructure:"cooldown"`
}

// ServerConfig holds HTTP server settings.
type ServerConfig struct {
	Host         string        `mapstructure:"host"`
	Port         int           `mapstructure:"port"`
	ReadTimeout  time.Duration `mapstructure:"read_timeout"`
	WriteTimeout time.Duration `mapstructure:"write_timeout"`
	IdleTimeout  time.Duration `mapstructure:"idle_timeout"`
	TLSEnabled   bool          `mapstructure:"tls_enabled"`
	TLSCert      string        `mapstructure:"tls_cert"`
	TLSKey       string        `mapstructure:"tls_key"`
	// TrustedProxies lists reverse-proxy CIDRs whose X-Forwarded-For entries are
	// trusted when deriving the client IP. Empty (the default) trusts no
	// forwarded headers: the TCP peer address is used, which cannot be spoofed.
	TrustedProxies []string `mapstructure:"trusted_proxies"`
}

// ProxyConfig holds proxy-specific settings.
type ProxyConfig struct {
	Enabled         bool          `mapstructure:"enabled"`
	DefaultProvider string        `mapstructure:"default_provider"`
	UpstreamTimeout time.Duration `mapstructure:"upstream_timeout"`
	RequireAuth     bool          `mapstructure:"require_auth"`
	MaxRequestBytes int           `mapstructure:"max_request_bytes"`
}

// ManagerConfig holds management API settings.
type ManagerConfig struct {
	Enabled        bool     `mapstructure:"enabled"`
	Host           string   `mapstructure:"host"`
	Port           int      `mapstructure:"port"`
	AdminToken     string   `mapstructure:"admin_token"`
	JWTSecret      string   `mapstructure:"jwt_secret"`
	AllowedOrigins []string `mapstructure:"allowed_origins"`
	WebEnabled     bool     `mapstructure:"web_enabled"`
	WebDistDir     string   `mapstructure:"web_dist_dir"`
}

// RedisConfig holds Redis connection settings.
type RedisConfig struct {
	Enabled  bool   `mapstructure:"enabled"`
	Addr     string `mapstructure:"addr"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

// ProviderConfig holds settings for a single upstream provider.
type ProviderConfig struct {
	Type    string `mapstructure:"type"`
	APIKey  string `mapstructure:"api_key"`
	BaseURL string `mapstructure:"base_url"`
	Enabled bool   `mapstructure:"enabled"`
	// Breaker overrides the global circuit-breaker settings for this provider.
	Breaker BreakerConfig `mapstructure:"breaker"`
	// Local carries GPU-hour cost accounting for self-hosted inference
	// (vLLM/llama.cpp/custom engines). Only used when Type == "local".
	Local LocalProviderConfig `mapstructure:"local"`
}

// LocalProviderConfig is the GPU-hour cost model for a self-hosted (local)
// provider. Cost is derived from wall-clock GPU time at a conservative declared
// throughput, not per-token API pricing.
type LocalProviderConfig struct {
	GPUHourCost             float64 `mapstructure:"gpu_hour_cost" json:"gpu_hour_cost,omitempty"`
	GPUCount                int     `mapstructure:"gpu_count" json:"gpu_count,omitempty"`
	DeclaredThroughputTPS   float64 `mapstructure:"declared_throughput_tps" json:"declared_throughput_tps,omitempty"`
	SafetyFactor            float64 `mapstructure:"safety_factor" json:"safety_factor,omitempty"`
	MinGPUSecondsPerRequest float64 `mapstructure:"min_gpu_seconds_per_request" json:"min_gpu_seconds_per_request,omitempty"`
}

// GuardianConfig holds security guardian settings.
type GuardianConfig struct {
	Enabled        bool `mapstructure:"enabled"`
	BlockInjection bool `mapstructure:"block_injection"`
	BlockJailbreak bool `mapstructure:"block_jailbreak"`
	RedactPII      bool `mapstructure:"redact_pii"`
}

// MetricsConfig holds Prometheus metrics settings.
type MetricsConfig struct {
	Enabled bool   `mapstructure:"enabled"`
	Port    int    `mapstructure:"port"`
	Path    string `mapstructure:"path"`
}

// OptimizerConfig selects the LLM used for prompt optimisation and the skill
// creation wizard. When Provider is empty, a lossless (whitespace-only)
// normaliser is used; when a provider is configured, its model is called to
// rewrite/compress prompts and to draft new skills.
type OptimizerConfig struct {
	Enabled    bool   `mapstructure:"enabled"`
	Provider   string `mapstructure:"provider"` // provider name under providers.*
	Model      string `mapstructure:"model"`
	ShadowMode bool   `mapstructure:"shadow_mode"`
}

// LoggingConfig holds logging settings.
type LoggingConfig struct {
	Level  string `mapstructure:"level"`
	Format string `mapstructure:"format"`
}

// Load reads configuration from the given file (optional) and environment variables.
// Environment variables use the MH_ prefix (e.g. MH_SERVER_PORT).
func Load(configFile string) *Config {
	v := viper.New()
	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	v.AddConfigPath("./configs")
	v.AddConfigPath("/etc/management-harness")

	if configFile != "" {
		v.SetConfigFile(configFile)
	}

	v.SetEnvPrefix("MH")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	// AutomaticEnv only resolves keys that are known (have a default or are
	// explicitly bound). Bind the secret keys so they can be supplied via the
	// environment (MH_MANAGER_ADMIN_TOKEN / MH_MANAGER_JWT_SECRET) as required
	// by the security remediation.
	_ = v.BindEnv("manager.admin_token")
	_ = v.BindEnv("manager.jwt_secret")

	setDefaults(v)

	if err := v.ReadInConfig(); err != nil {
		if configFile != "" {
			// Only fatal if an explicit config file was requested.
			panic(fmt.Sprintf("failed to read config %q: %v", configFile, err))
		}
		// Otherwise fall back to defaults + env.
	}

	cfg := &Config{}
	if err := v.Unmarshal(cfg); err != nil {
		panic(fmt.Sprintf("failed to unmarshal config: %v", err))
	}
	if err := cfg.Validate(); err != nil {
		panic(fmt.Sprintf("invalid configuration: %v", err))
	}
	parseLocalBlocks(cfg, v)
	applyProviderEnvOverrides(cfg)
	// Validate again after dynamic provider environment overrides have been
	// applied so the effective configuration, not just the static file, is gated.
	if err := cfg.Validate(); err != nil {
		panic(fmt.Sprintf("invalid effective configuration: %v", err))
	}
	return cfg
}

// parseLocalBlocks back-fills any all-zero local (GPU-hour) blocks in the
// provider config by reading config.yaml with yaml.v3 directly.  The root
// cause is that Viper's mapstructure decoder silently drops intermediate
// nested maps when the struct field has omitempty / JSON tags on it.
func parseLocalBlocks(cfg *Config, v *viper.Viper) {
	// The YAML fallback is best-effort defense-in-depth on top of Viper: a
	// malformed AST or type-assertion failure must never crash boot. Recover
	// and surface the error on stderr so it is diagnosable (the config package
	// intentionally does not depend on the app logger).
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(os.Stderr, "[config] parseLocalBlocks aborted: %v\n", r)
		}
	}()
	if v.ConfigFileUsed() == "" {
		return
	}
	data, err := os.ReadFile(v.ConfigFileUsed())
	if err != nil {
		return
	}

	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return
	}

	pm := findMapChild(&root, "providers")
	if pm == nil {
		return
	}
	for name, p := range cfg.Providers {
		if p.Type != "local" {
			continue
		}
		if p.Local.GPUHourCost != 0 || p.Local.GPUCount != 0 ||
			p.Local.DeclaredThroughputTPS != 0 || p.Local.SafetyFactor != 0 ||
			p.Local.MinGPUSecondsPerRequest != 0 {
			continue
		}
		pcfg := findMapChild(pm, name)
		if pcfg == nil {
			continue
		}
		lcfg := findMapChild(pcfg, "local")
		if lcfg == nil {
			continue
		}
		l := cfg.Providers[name]
		walkYAMLFields(lcfg, func(k string, n *yaml.Node) {
			switch k {
			case "gpu_hour_cost":
				l.Local.GPUHourCost = parseYAMLFloat(n.Value, "gpu_hour_cost")
			case "gpu_count":
				l.Local.GPUCount = int(parseYAMLFloat(n.Value, "gpu_count"))
			case "declared_throughput_tps":
				l.Local.DeclaredThroughputTPS = parseYAMLFloat(n.Value, "declared_throughput_tps")
			case "safety_factor":
				l.Local.SafetyFactor = parseYAMLFloat(n.Value, "safety_factor")
			case "min_gpu_seconds_per_request":
				l.Local.MinGPUSecondsPerRequest = parseYAMLFloat(n.Value, "min_gpu_seconds_per_request")
			}
		})
		cfg.Providers[name] = l
	}
}

func parseYAMLFloat(s, key string) float64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		// Could use zap here; fail silently to avoid a hard dep during config init
		return 0
	}
	return v
}

func findMapChild(n *yaml.Node, key string) *yaml.Node {
	if n == nil {
		return nil
	}
	if n.Kind == yaml.DocumentNode {
		if len(n.Content) == 1 {
			return findMapChild(n.Content[0], key)
		}
		return nil
	}
	if n.Kind != yaml.MappingNode && n.Kind != yaml.SequenceNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		kNode, vNode := n.Content[i], n.Content[i+1]
		if kNode.Kind == yaml.ScalarNode && kNode.Value == key {
			return vNode
		}
	}
	return nil
}

func walkYAMLFields(n *yaml.Node, f func(string, *yaml.Node)) {
	if n == nil || n.Kind != yaml.MappingNode {
		return
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		kNode, vNode := n.Content[i], n.Content[i+1]
		if kNode.Kind == yaml.ScalarNode {
			f(kNode.Value, vNode)
		}
	}
}

// applyProviderEnvOverrides honors the documented per-provider env overrides
// (MH_PROVIDERS_<NAME>_API_KEY / _ENABLED / _BASE_URL). Viper's AutomaticEnv
// cannot resolve keys that only exist inside a dynamic providers.* map, so we
// apply them explicitly for each configured provider.

func applyProviderEnvOverrides(cfg *Config) {
	for name, p := range cfg.Providers {
		key := strings.ToUpper(name)
		if v := os.Getenv("MH_PROVIDERS_" + key + "_API_KEY"); v != "" {
			p.APIKey = v
		}
		if v := os.Getenv("MH_PROVIDERS_" + key + "_ENABLED"); v != "" {
			if b, err := strconv.ParseBool(v); err == nil {
				p.Enabled = b
			}
		}
		if v := os.Getenv("MH_PROVIDERS_" + key + "_BASE_URL"); v != "" {
			p.BaseURL = v
		}
		cfg.Providers[name] = p
	}
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.read_timeout", 30*time.Second)
	v.SetDefault("server.write_timeout", 30*time.Second)
	v.SetDefault("server.idle_timeout", 120*time.Second)
	v.SetDefault("server.tls_enabled", false)
	v.SetDefault("server.tls_cert", "")
	v.SetDefault("server.tls_key", "")
	v.SetDefault("server.trusted_proxies", []string{})

	v.SetDefault("proxy.enabled", true)
	v.SetDefault("proxy.default_provider", "kilo")
	v.SetDefault("proxy.upstream_timeout", 60*time.Second)
	v.SetDefault("proxy.require_auth", true)
	v.SetDefault("proxy.max_request_bytes", 4*1024*1024)

	v.SetDefault("manager.enabled", true)
	v.SetDefault("manager.host", "0.0.0.0")
	v.SetDefault("manager.port", 8090)
	v.SetDefault("manager.allowed_origins", []string{"http://localhost:8090"})
	v.SetDefault("manager.web_enabled", true)
	v.SetDefault("manager.web_dist_dir", "internal/web/dist")

	v.SetDefault("redis.enabled", false)
	v.SetDefault("redis.addr", "localhost:6379")
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)

	v.SetDefault("guardian.enabled", true)
	v.SetDefault("guardian.block_injection", true)
	v.SetDefault("guardian.block_jailbreak", true)
	v.SetDefault("guardian.redact_pii", true)

	v.SetDefault("metrics.enabled", true)
	v.SetDefault("metrics.port", 9091)
	v.SetDefault("metrics.path", "/metrics")

	v.SetDefault("pricing.default_rate", 3.0)

	v.SetDefault("optimizer.enabled", false)
	v.SetDefault("optimizer.provider", "")
	v.SetDefault("optimizer.model", "nvidia/nemotron-3.5-lightning-30b-a3b")
	v.SetDefault("optimizer.shadow_mode", false)

	// Circuit breaker: conservative production defaults. Per-provider overrides
	// may be supplied via providers.<name>.breaker.
	v.SetDefault("breaker.max_failures", 5)
	v.SetDefault("breaker.cooldown", 10*time.Second)

	v.SetDefault("logging.level", "info")
	v.SetDefault("logging.format", "json")
}

// Insecure default secrets that must never be used in a real deployment.
var insecureSecrets = map[string]bool{
	"":                         true,
	"dev-admin-token":          true,
	"dev-jwt-secret-change-me": true,
	"changeme":                 true,
	"secret":                   true,
	// Placeholders shipped in .env.example — rejected so a copied-but-unchanged
	// template fails fast rather than booting with guessable credentials.
	"change-me-admin-token": true,
	"change-me-jwt-secret":  true,
}

// Validate checks the configuration for correctness.
func (c *Config) Validate() error {
	if c.Server.Port <= 0 || c.Server.Port > 65535 {
		return fmt.Errorf("server.port must be between 1 and 65535")
	}
	if c.Manager.Port <= 0 || c.Manager.Port > 65535 {
		return fmt.Errorf("manager.port must be between 1 and 65535")
	}
	if c.Server.TLSEnabled {
		if c.Server.TLSCert == "" || c.Server.TLSKey == "" {
			return fmt.Errorf("server.tls_enabled requires server.tls_cert and server.tls_key")
		}
	}
	for _, cidr := range c.Server.TrustedProxies {
		if _, err := netip.ParsePrefix(cidr); err != nil {
			return fmt.Errorf("server.trusted_proxies contains invalid CIDR %q: %w", cidr, err)
		}
	}
	if c.Proxy.MaxRequestBytes <= 0 {
		return fmt.Errorf("proxy.max_request_bytes must be greater than 0")
	}
	if c.Proxy.UpstreamTimeout <= 0 {
		return fmt.Errorf("proxy.upstream_timeout must be greater than 0")
	}
	if c.Server.ReadTimeout <= 0 || c.Server.WriteTimeout <= 0 || c.Server.IdleTimeout <= 0 {
		return fmt.Errorf("server timeouts must be greater than 0")
	}
	if c.Breaker.MaxFailures <= 0 || c.Breaker.Cooldown <= 0 {
		return fmt.Errorf("breaker.max_failures and breaker.cooldown must be greater than 0")
	}
	if c.Pricing.DefaultRate < 0 {
		return fmt.Errorf("pricing.default_rate must not be negative")
	}
	if c.Guardian.RedactPII && !c.Guardian.Enabled {
		return fmt.Errorf("guardian.redact_pii requires guardian.enabled")
	}
	// Reject wildcard CORS origins in any environment.
	for _, o := range c.Manager.AllowedOrigins {
		if o == "*" {
			return fmt.Errorf("manager.allowed_origins must not contain \"*\"; specify explicit origins")
		}
	}
	// Reject insecure default secrets.
	if insecureSecrets[c.Manager.AdminToken] {
		return fmt.Errorf("manager.admin_token is using an insecure default; set MH_MANAGER_ADMIN_TOKEN")
	}
	if insecureSecrets[c.Manager.JWTSecret] {
		return fmt.Errorf("manager.jwt_secret is using an insecure default; set MH_MANAGER_JWT_SECRET")
	}
	return nil
}
