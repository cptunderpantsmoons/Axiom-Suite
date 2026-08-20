package audit

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/core/models"
)

func TestHashChainIntegrity(t *testing.T) {
	chain := NewHashChain(genesis)
	e1 := &models.AuditEvent{ID: "1", Action: "auth.login", UserID: "u1"}
	e2 := &models.AuditEvent{ID: "2", Action: "proxy.request", UserID: "u1"}
	chain.Next(e1)
	chain.Next(e2)

	assert.NotEmpty(t, e1.Hash)
	assert.NotEmpty(t, e2.Hash)
	assert.NotEqual(t, e1.Hash, e2.Hash)
	assert.True(t, VerifyHash(e1))
	assert.True(t, VerifyHash(e2))

	// Tamper detection.
	e1.Action = "proxy.request"
	assert.False(t, VerifyHash(e1))
}

func TestVerifyChainSequence(t *testing.T) {
	chain := NewHashChain(genesis)
	events := []*models.AuditEvent{
		{ID: "1", Action: "a"},
		{ID: "2", Action: "b"},
		{ID: "3", Action: "c"},
	}
	for _, e := range events {
		chain.Next(e)
	}
	ok, idx := verifyChainIntegrity(events, genesis)
	assert.True(t, ok)
	assert.Equal(t, -1, idx)

	events[1].Action = "tampered"
	ok, idx = verifyChainIntegrity(events, genesis)
	assert.False(t, ok)
	assert.Equal(t, 1, idx)
}

func TestAuditLoggerWritesToMemory(t *testing.T) {
	mem := NewMemorySink()
	logger := NewAuditLogger([]AuditSink{mem})
	require.NoError(t, logger.Log(context.Background(), &models.AuditEvent{Action: "proxy.request", UserID: "u1"}))
	require.NoError(t, logger.Flush(context.Background()))
	assert.Len(t, mem.Events(), 1)
}
