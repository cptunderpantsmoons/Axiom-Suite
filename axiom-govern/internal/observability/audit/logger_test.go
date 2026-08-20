// Package audit implements the immutable, hash-chained audit log.
package audit

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/laiw/management-harness/internal/core/models"
)

func TestAuditLoggerNoDropAndPersist(t *testing.T) {
	chainFile := filepath.Join(t.TempDir(), "chain.txt")
	t.Setenv("MH_AUDIT_CHAIN_FILE", chainFile)

	sinks := []AuditSink{NewMemorySink()}
	l := NewAuditLogger(sinks)
	l.Start(context.Background())

	const n = 500
	for i := 0; i < n; i++ {
		if err := l.Log(context.Background(), &models.AuditEvent{Action: "proxy.request", Outcome: "success"}); err != nil {
			t.Fatalf("Log returned error: %v", err)
		}
	}

	// Force a synchronous flush and stop the worker.
	if err := l.Flush(context.Background()); err != nil {
		t.Fatalf("Flush error: %v", err)
	}
	if err := l.Close(); err != nil {
		t.Fatalf("Close error: %v", err)
	}

	ms := sinks[0].(*MemorySink)
	if got := len(ms.Events()); got != n {
		t.Fatalf("expected %d events, got %d (events were dropped)", n, got)
	}

	ok, err := l.VerifyChain()
	if err != nil {
		t.Fatalf("VerifyChain error: %v", err)
	}
	if !ok {
		t.Fatalf("hash chain integrity check failed")
	}

	// Chain hash must have been persisted to disk.
	data, err := os.ReadFile(chainFile)
	if err != nil {
		t.Fatalf("chain file not written: %v", err)
	}
	if len(data) == 0 {
		t.Fatalf("chain file is empty")
	}
}

func TestFileSinkWriteIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "audit.ndjson")
	sink, err := NewFileSink(path)
	if err != nil {
		t.Fatalf("NewFileSink: %v", err)
	}
	defer sink.Close()

	events := []*models.AuditEvent{
		{ID: "a", Action: "one"},
		{ID: "b", Action: "two"},
	}
	if err := sink.Write(context.Background(), events); err != nil {
		t.Fatalf("first Write: %v", err)
	}
	// A retried batch must not append duplicate lines.
	if err := sink.Write(context.Background(), events); err != nil {
		t.Fatalf("retry Write: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read audit file: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != len(events) {
		t.Fatalf("expected %d lines, got %d: %q", len(events), len(lines), string(data))
	}
}

func TestAuditLoggerLoadsPersistedChain(t *testing.T) {
	chainFile := filepath.Join(t.TempDir(), "chain.txt")
	t.Setenv("MH_AUDIT_CHAIN_FILE", chainFile)

	// First logger writes and persists a chain.
	l1 := NewAuditLogger([]AuditSink{NewMemorySink()})
	l1.Start(context.Background())
	_ = l1.Log(context.Background(), &models.AuditEvent{Action: "a", Outcome: "ok"})
	_ = l1.Flush(context.Background())
	_ = l1.Close()

	// A new logger should continue the chain from the persisted hash.
	l2 := NewAuditLogger([]AuditSink{NewMemorySink()})
	l2.Start(context.Background())
	ev := &models.AuditEvent{Action: "b", Outcome: "ok"}
	_ = l2.Log(context.Background(), ev)
	_ = l2.Flush(context.Background())
	_ = l2.Close()

	if ev.PreviousHash == genesis {
		t.Fatalf("expected chain to continue from persisted hash, got genesis")
	}
	time.Sleep(10 * time.Millisecond)
}
