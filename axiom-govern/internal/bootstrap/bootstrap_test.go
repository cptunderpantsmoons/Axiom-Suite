package bootstrap

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/laiw/management-harness/internal/components/circuitbreaker"
	"github.com/laiw/management-harness/internal/core/config"
	"github.com/laiw/management-harness/internal/core/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// minimalConfig renders a valid config.yaml with the given breaker settings and
// a single always-failing upstream at upstreamURL. stubBreaker (if non-empty) is
// inserted under providers.stub; globalBreaker under the top-level breaker key.
func minimalConfig(t *testing.T, upstreamURL, globalBreaker, stubBreaker string) string {
	t.Helper()
	return `server:
  port: 8080
manager:
  port: 8090
  admin_token: "test-admin-token-1234"
  jwt_secret: "test-jwt-secret-12345"
proxy:
  max_request_bytes: 1048576
guardian:
  enabled: true
  redact_pii: true
providers:
  stub:
    type: openai
    api_key: "sk-test"
    base_url: "` + upstreamURL + `"
    enabled: true
` + stubBreaker + `
` + globalBreaker
}

func TestBreakerThresholdsFromConfig(t *testing.T) {
	// Local upstream that always fails (HTTP 500) so the breaker observes errors.
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	cfg := minimalConfig(t, upstream.URL, "", "breaker:\n  max_failures: 3\n  cooldown: 2s\n")
	require.NoError(t, os.WriteFile(cfgPath, []byte(cfg), 0o644))
	t.Logf("CFG:\n%s", cfg)

	d, err := Build(cfgPath)
	require.NoError(t, err)
	defer Shutdown(d)

	wrapped, ok := d.Providers.Snapshot()["stub"].(*circuitbreaker.Provider)
	require.True(t, ok, "expected circuit-breaker-wrapped provider")
	require.Equal(t, 3, wrapped.Config().MaxFailures, "breaker must honour config")
	require.Equal(t, 2*time.Second, wrapped.Config().Cooldown)

	// max_failures=3: the 4th call must be rejected by the now-open breaker
	// before reaching the (failing) upstream.
	for i := 0; i < 3; i++ {
		_, err := wrapped.ChatCompletion(context.Background(), &models.ChatRequest{})
		assert.Error(t, err, "call %d should reach the failing upstream", i)
	}
	_, err = wrapped.ChatCompletion(context.Background(), &models.ChatRequest{})
	assert.Error(t, err)
	assert.Equal(t, circuitbreaker.StateOpen, wrapped.State(), "breaker should be open after max failures")
}

func TestPerProviderBreakerOverride(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.yaml")
	cfg := minimalConfig(t, "http://127.0.0.1:1", "breaker:\n  max_failures: 5\n  cooldown: 10s\n", "\n    breaker:\n      max_failures: 9\n      cooldown: 30s")
	require.NoError(t, os.WriteFile(cfgPath, []byte(cfg), 0o644))

	loaded := config.Load(cfgPath)
	// Per-provider override wins over the global default.
	require.Equal(t, 9, loaded.Providers["stub"].Breaker.MaxFailures)
	require.Equal(t, 30*time.Second, loaded.Providers["stub"].Breaker.Cooldown)
	// Global default is unaffected.
	require.Equal(t, 5, loaded.Breaker.MaxFailures)
	require.Equal(t, 10*time.Second, loaded.Breaker.Cooldown)
}
