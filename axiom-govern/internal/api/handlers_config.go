// Package api implements the Management Harness management REST API.
package api

import (
	"encoding/json"
	"net/http"
	"sort"
	"time"

	"github.com/laiw/management-harness/internal/core/config"
)

// handleGetConfig returns the active configuration with all secret material
// masked. Providers reflect any runtime (dashboard) overrides; core settings are
// the effective values (static config.yaml overlaid with runtime settings applied
// at startup).
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.renderConfig())
}

// handlePutConfig persists runtime-mutable settings (providers, API keys, and
// settings) and triggers a live provider reload on the proxy. It is admin-only.
func (s *Server) handlePutConfig(w http.ResponseWriter, r *http.Request) {
	if s.deps == nil || s.deps.RuntimeStore == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "runtime config store is unavailable"})
		return
	}
	var rt config.RuntimeSettings
	if err := json.NewDecoder(r.Body).Decode(&rt); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid configuration payload: " + err.Error()})
		return
	}
	for name, provider := range rt.Providers {
		if _, ok := s.cfg.Providers[name]; !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown provider: " + name})
			return
		}
		if provider.Cooldown != "" {
			if _, err := time.ParseDuration(provider.Cooldown); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid provider cooldown for " + name})
				return
			}
		}
	}
	candidate := *s.cfg
	config.ApplyRuntime(&candidate, rt)
	if err := candidate.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid effective configuration: " + err.Error()})
		return
	}
	if err := s.deps.RuntimeStore.Save(rt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to persist configuration: " + err.Error()})
		return
	}
	s.auditEvent(r, "admin.config.update", "/api/v1/config", "success")
	writeJSON(w, http.StatusOK, s.renderConfig())
}

// effectiveProviders returns the provider config with runtime overrides applied.
// When no providers are overridden in the runtime store it returns the static
// configuration (so a brand-new deployment shows the full shipped list).
func (s *Server) effectiveProviders() map[string]config.ProviderConfig {
	static := s.cfg.Providers
	if s.deps != nil && s.deps.RuntimeStore != nil && s.deps.RuntimeStore.Exists() {
		if ov := s.deps.RuntimeStore.Get().Providers; ov != nil && len(ov) > 0 {
			return config.MergeProviders(static, ov)
		}
	}
	return static
}

// renderConfig builds the masked configuration view returned to the dashboard.
func (s *Server) renderConfig() map[string]interface{} {
	// Build a display copy of the config overlaid with the saved runtime settings,
	// so the dashboard reflects persisted intent (settings take effect on restart;
	// providers reload live).
	cfg := *s.cfg
	if s.deps != nil && s.deps.RuntimeStore != nil && s.deps.RuntimeStore.Exists() {
		config.ApplyRuntime(&cfg, s.deps.RuntimeStore.Get())
	}
	set := func(v string) bool { return v != "" }

	effective := s.effectiveProviders()
	providers := make([]map[string]interface{}, 0, len(effective))
	names := make([]string, 0, len(effective))
	for name := range effective {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		p := effective[name]
		providers = append(providers, map[string]interface{}{
			"name":         name,
			"type":         p.Type,
			"base_url":     p.BaseURL,
			"enabled":      p.Enabled,
			"api_key_set":  set(p.APIKey),
			"max_failures": p.Breaker.MaxFailures,
			"cooldown":     p.Breaker.Cooldown.String(),
			"local": map[string]interface{}{
				"gpu_hour_cost":              p.Local.GPUHourCost,
				"gpu_count":                  p.Local.GPUCount,
				"declared_throughput_tps":     p.Local.DeclaredThroughputTPS,
				"safety_factor":              p.Local.SafetyFactor,
				"min_gpu_seconds_per_request": p.Local.MinGPUSecondsPerRequest,
			},
		})
	}

	return map[string]interface{}{
		"proxy": map[string]interface{}{
			"enabled":           cfg.Proxy.Enabled,
			"default_provider":  cfg.Proxy.DefaultProvider,
			"upstream_timeout":  cfg.Proxy.UpstreamTimeout.String(),
			"require_auth":      cfg.Proxy.RequireAuth,
			"max_request_bytes": cfg.Proxy.MaxRequestBytes,
		},
		"guardian": map[string]interface{}{
			"enabled":         cfg.Guardian.Enabled,
			"block_injection": cfg.Guardian.BlockInjection,
			"block_jailbreak": cfg.Guardian.BlockJailbreak,
			"redact_pii":      cfg.Guardian.RedactPII,
		},
		"pricing": map[string]interface{}{
			"default_rate": cfg.Pricing.DefaultRate,
		},
		"breaker": map[string]interface{}{
			"max_failures": cfg.Breaker.MaxFailures,
			"cooldown":     cfg.Breaker.Cooldown.String(),
		},
		"metrics": map[string]interface{}{
			"enabled": cfg.Metrics.Enabled,
			"port":    cfg.Metrics.Port,
			"path":    cfg.Metrics.Path,
		},
		"manager": map[string]interface{}{
			"enabled":         cfg.Manager.Enabled,
			"port":            cfg.Manager.Port,
			"admin_token_set": set(cfg.Manager.AdminToken),
			"jwt_secret_set":  set(cfg.Manager.JWTSecret),
		},
		"redis": map[string]interface{}{
			"enabled":      cfg.Redis.Enabled,
			"addr":         cfg.Redis.Addr,
			"db":           cfg.Redis.DB,
			"password_set": set(cfg.Redis.Password),
		},
		"optimizer": map[string]interface{}{
			"enabled":     cfg.Optimizer.Enabled,
			"provider":    cfg.Optimizer.Provider,
			"model":       cfg.Optimizer.Model,
			"shadow_mode": cfg.Optimizer.ShadowMode,
		},
		"providers": providers,
	}
}