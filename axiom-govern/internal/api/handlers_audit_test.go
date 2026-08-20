// Package api implements the Management Harness management REST API.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/core/config"
	"github.com/laiw/management-harness/internal/core/deps"
	"github.com/laiw/management-harness/internal/observability/audit"
	"github.com/laiw/management-harness/internal/observability/metrics"
)

// TestManagerAuditEndpointsSurfaceEvents verifies that admin actions recorded
// via auditEvent are surfaced by the /audit endpoints and pass hash-chain
// verification — i.e. the management audit trail is wired to the real logger
// rather than a disconnected sink.
func TestManagerAuditEndpointsSurfaceEvents(t *testing.T) {
	logger := audit.NewAuditLogger([]audit.AuditSink{audit.NewMemorySink()})
	logger.Start(context.Background())
	defer logger.Close()

	d := &deps.Dependencies{Audit: logger, Metrics: metrics.NewMetricsCollector()}
	cfg := &config.Config{Manager: config.ManagerConfig{AllowedOrigins: []string{"http://localhost:8090"}}}
	s := NewServer(cfg, d)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/users", nil)
	s.auditEvent(req, "admin.user.create", "/api/v1/users", "success")
	require.NoError(t, logger.Flush(context.Background()))

	// List.
	rr := httptest.NewRecorder()
	s.handleListAuditEvents(rr, httptest.NewRequest(http.MethodGet, "/api/v1/audit/events", nil))
	require.Equal(t, http.StatusOK, rr.Code)

	var list struct {
		Events []json.RawMessage `json:"events"`
	}
	require.NoError(t, json.Unmarshal(rr.Body.Bytes(), &list))
	require.Len(t, list.Events, 1)

	// Verify.
	rr2 := httptest.NewRecorder()
	s.handleVerifyAudit(rr2, httptest.NewRequest(http.MethodGet, "/api/v1/audit/verify", nil))
	require.Equal(t, http.StatusOK, rr2.Code)
	require.JSONEq(t, `{"verified":true}`, rr2.Body.String())
}