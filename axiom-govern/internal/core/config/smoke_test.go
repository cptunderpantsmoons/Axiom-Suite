package config_test

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/laiw/management-harness/internal/core/config"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

const (
	adminToken = "test-admin-token-1234"
	jwtSecret  = "test-jwt-secret-5678"
)

// cfgYAML is resolved from the package working directory so the test is
// portable across machines/CIs. go test runs with cwd = internal/core/config,
// so the repo root is three levels up. The test skips when the file is absent
// (e.g. when only the package is copied out), keeping the plugin self-contained.
var cfgYAML = mustAbs("../../../configs/config.yaml")

func mustAbs(rel string) string {
	abs, err := filepath.Abs(rel)
	if err != nil {
		panic(err)
	}
	return abs
}

func env(t *testing.T) {
	t.Helper()
	os.Setenv("MH_MANAGER_ADMIN_TOKEN", adminToken)
	os.Setenv("MH_MANAGER_JWT_SECRET", jwtSecret)
}

// localYAML is a minimal self-contained fixture used by the yaml.v3 parse test.
var localYAML = []byte("providers:\n  local:\n    type: local\n    base_url: \"http://127.0.0.1:8000/v1\"\n    enabled: false\n    local:\n      gpu_hour_cost: 2.5\n      gpu_count: 1\n      declared_throughput_tps: 90\n      safety_factor: 1.25\n      min_gpu_seconds_per_request: 3\n")

// TestYAMLNodeRevealsLocalBlock confirms that yaml.v3 can parse the inner local
// block and read the expected GPU-hour values from it.
func TestYAMLNodeRevealsLocalBlock(t *testing.T) {
	var root yaml.Node
	require.NoError(t, yaml.Unmarshal(localYAML, &root))

	provs := findMapChild(&root, "providers")
	require.NotNil(t, provs, "yaml must have a providers section")

	localNd := findMapChild(provs, "local")
	require.NotNil(t, localNd, "providers.local must exist in raw YAML")
	require.Equal(t, "local", stringFrom(localNd, "type"))
	require.Equal(t, "http://127.0.0.1:8000/v1", stringFrom(localNd, "base_url"))

	lBlk := findMapChild(localNd, "local")
	require.NotNil(t, lBlk, "providers.local.local GPU block must exist")
	require.InDelta(t, 2.5, floatFrom(lBlk, "gpu_hour_cost"), 0.01)
	require.InDelta(t, 1.0, floatFrom(lBlk, "gpu_count"), 0.01)
	require.InDelta(t, 90.0, floatFrom(lBlk, "declared_throughput_tps"), 0.01)
	require.InDelta(t, 1.25, floatFrom(lBlk, "safety_factor"), 0.01)
	require.InDelta(t, 3.0, floatFrom(lBlk, "min_gpu_seconds_per_request"), 0.01)
}

// TestMergeProvidersLocalEmptyOverrideIsSafe verifies that an empty local override
// from runtime.json (dashboard not yet filled in) does NOT zero the static block.
func TestMergeProvidersLocalEmptyOverrideIsSafe(t *testing.T) {
	static := map[string]config.ProviderConfig{
		"local": {
			Type: "local",
			Local: config.LocalProviderConfig{
				GPUHourCost: 2.5, GPUCount: 1, DeclaredThroughputTPS: 90,
				SafetyFactor: 1.25, MinGPUSecondsPerRequest: 3,
			},
		},
	}

	emptyRO := map[string]config.ProviderOverride{
		"local": {Type: "local", Enabled: false},
	}

	out := config.MergeProviders(static, emptyRO)

	require.Equal(t, "local", out["local"].Type)
	require.False(t, out["local"].Enabled)
	require.InDelta(t, 2.5, out["local"].Local.GPUHourCost, 0.01)
	require.Equal(t, 1, out["local"].Local.GPUCount)
	require.InDelta(t, 90.0, out["local"].Local.DeclaredThroughputTPS, 0.01)
	require.InDelta(t, 1.25, out["local"].Local.SafetyFactor, 0.01)
	require.Equal(t, 3, int(out["local"].Local.MinGPUSecondsPerRequest))
}

// TestMergeProvidersNonZeroOverrideWins confirms that a non-zero GPU block
// supplied by the admin in the dashboard wins over the static default.
func TestMergeProvidersNonZeroOverrideWins(t *testing.T) {
	po := config.ProviderOverride{
		Type: "local", Enabled: true,
		Local: config.LocalProviderConfig{
			GPUHourCost: 9.99, GPUCount: 8, DeclaredThroughputTPS: 200,
			SafetyFactor: 2.5, MinGPUSecondsPerRequest: 30,
		},
	}
	out := config.MergeProviders(
		map[string]config.ProviderConfig{"local": {Type: "local"}},
		map[string]config.ProviderOverride{"local": po},
	)
	ml := out["local"]
	require.Equal(t, "local", ml.Type)
	require.True(t, ml.Enabled)
	require.InDelta(t, 9.99, ml.Local.GPUHourCost, 0.01)
	require.Equal(t, 8, ml.Local.GPUCount)
	require.InDelta(t, 200.0, ml.Local.DeclaredThroughputTPS, 0.01)
	require.InDelta(t, 2.5, ml.Local.SafetyFactor, 0.01)
	require.Equal(t, 30, int(ml.Local.MinGPUSecondsPerRequest))
}

// TestConfigLoadPopulatesGpuBlock is the end-to-end integration test: Load(path)
// -> parseLocalBlocks -> assert correct GPU values in cfg.Providers["local"].Local.
func TestConfigLoadPopulatesGpuBlock(t *testing.T) {
	env(t)
	if _, err := os.Stat(cfgYAML); err != nil {
		t.Skipf("config.yaml not present (%s); skipping live-load integration check", cfgYAML)
	}
	cfg := config.Load(cfgYAML)

	lp, ok := cfg.Providers["local"]
	require.True(t, ok, "config.yaml must define a local provider")
	t.Logf("gpu_hour_cost=%.1f gpu_count=%d tps=%.1f safety=%.2f minSec=%.1f",
		lp.Local.GPUHourCost, lp.Local.GPUCount,
		lp.Local.DeclaredThroughputTPS, lp.Local.SafetyFactor,
		lp.Local.MinGPUSecondsPerRequest)

	require.Equal(t, "local", lp.Type)
	require.InDelta(t, 2.5, lp.Local.GPUHourCost, 0.01)
	require.Equal(t, 1, lp.Local.GPUCount)
	require.InDelta(t, 90.0, lp.Local.DeclaredThroughputTPS, 0.01)
	require.InDelta(t, 1.25, lp.Local.SafetyFactor, 0.01)
}

// TestLocalConfigIsEmptyExported verifies the static empty-check helper.
func TestLocalConfigIsEmptyExported(t *testing.T) {
	require.True(t, config.LocalConfigIsEmpty(config.LocalProviderConfig{}))
	require.False(t, config.LocalConfigIsEmpty(config.LocalProviderConfig{GPUHourCost: 2.5}))
}

// Helpers
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
		if n.Content[i].Kind == yaml.ScalarNode && n.Content[i].Value == key {
			return n.Content[i+1]
		}
	}
	return nil
}

func floatFrom(n *yaml.Node, key string) float64 {
	child := findMapChild(n, key)
	if child == nil {
		return 0
	}
	v, _ := strconv.ParseFloat(child.Value, 64)
	return v
}

func stringFrom(n *yaml.Node, key string) string {
	child := findMapChild(n, key)
	if child == nil {
		return ""
	}
	return child.Value
}
