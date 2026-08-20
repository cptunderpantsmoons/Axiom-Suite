// Package audit implements the immutable, hash-chained audit log.
package audit

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/laiw/management-harness/internal/core/models"
)

const genesis = "harness-genesis-v1"

// AuditSink receives flushed audit events.
type AuditSink interface {
	Write(ctx context.Context, events []*models.AuditEvent) error
	Close() error
}

// FileSink writes audit events to a newline-delimited JSON file.
type FileSink struct {
	path string
	f    *os.File
	mu   sync.Mutex
	seen map[string]struct{}
}

// NewFileSink creates a file-backed audit sink.
func NewFileSink(path string) (*FileSink, error) {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return &FileSink{path: path, f: f, seen: map[string]struct{}{}}, nil
}

// Write appends events as NDJSON. Writes are idempotent per event ID so that a
// retried batch (after a partial write or fsync failure) never appends
// duplicate lines to the immutable audit trail.
func (s *FileSink) Write(ctx context.Context, events []*models.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	for _, e := range events {
		if e == nil {
			continue
		}
		if e.ID != "" {
			if _, exists := s.seen[e.ID]; exists {
				continue
			}
		}
		b, err := json.Marshal(e)
		if err != nil {
			return err
		}
		if _, err := s.f.Write(append(b, '\n')); err != nil {
			return err
		}
		if e.ID != "" {
			s.seen[e.ID] = struct{}{}
		}
	}
	return s.f.Sync()
}

// Close closes the underlying file.
func (s *FileSink) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.f.Close()
}

// MemorySink keeps events in memory (useful for verification and tests).
type MemorySink struct {
	mu     sync.Mutex
	events []*models.AuditEvent
	seen   map[string]struct{}
}

// NewMemorySink creates an in-memory audit sink.
func NewMemorySink() *MemorySink { return &MemorySink{seen: map[string]struct{}{}} }

// Write stores events in memory.
func (s *MemorySink) Write(ctx context.Context, events []*models.AuditEvent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, event := range events {
		if event == nil {
			continue
		}
		if event.ID != "" {
			if _, exists := s.seen[event.ID]; exists {
				continue
			}
			s.seen[event.ID] = struct{}{}
		}
		s.events = append(s.events, cloneAuditEvent(event))
	}
	return nil
}

// Events returns a snapshot of stored events.
func (s *MemorySink) Events() []*models.AuditEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*models.AuditEvent, len(s.events))
	for i, event := range s.events {
		out[i] = cloneAuditEvent(event)
	}
	return out
}

// Close is a no-op for the memory sink.
func (s *MemorySink) Close() error { return nil }

// AuditLogger buffers audit events and flushes them to configured sinks
// while maintaining a hash chain for immutability. Events are never silently
// dropped: they are appended to an in-memory queue that is drained by a
// background worker. On shutdown the queue is fully flushed before the sinks
// are closed. When MH_AUDIT_CHAIN_FILE is set, the latest chain hash is
// persisted so integrity survives restarts.
type AuditLogger struct {
	sinks     []AuditSink
	mu        sync.Mutex
	queue     []*models.AuditEvent
	chain     *HashChain
	seed      string
	chainFile string
	log       *zap.Logger
	stop      chan struct{}
	notify    chan struct{}
	wg        sync.WaitGroup
}

// NewAuditLogger constructs an AuditLogger with the given sinks.
func NewAuditLogger(sinks []AuditSink) *AuditLogger {
	chainFile := os.Getenv("MH_AUDIT_CHAIN_FILE")
	seed := genesis
	if chainFile != "" {
		if b, err := os.ReadFile(chainFile); err == nil && len(strings.TrimSpace(string(b))) > 0 {
			seed = strings.TrimSpace(string(b))
		}
	}
	return &AuditLogger{
		sinks:     sinks,
		chain:     NewHashChain(seed),
		seed:      seed,
		chainFile: chainFile,
		log:       zap.L().Named("audit"),
		stop:      make(chan struct{}),
		notify:    make(chan struct{}, 1),
	}
}

// Start launches the background flush worker.
func (l *AuditLogger) Start(ctx context.Context) {
	l.wg.Add(1)
	go func() {
		defer l.wg.Done()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-l.notify:
				l.drain(ctx)
			case <-ticker.C:
				l.drain(ctx)
			case <-l.stop:
				l.drain(ctx)
				return
			}
		}
	}()
}

// Log stamps and enqueues an audit event. It never drops events; under load it
// appends to the queue, which the flush worker drains.
func (l *AuditLogger) Log(ctx context.Context, event *models.AuditEvent) error {
	if event.ID == "" {
		event.ID = uuid.NewString()
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}
	l.mu.Lock()
	l.chain.Next(event)
	l.queue = append(l.queue, event)
	l.mu.Unlock()

	// Signal the worker without blocking the caller.
	select {
	case l.notify <- struct{}{}:
	default:
	}
	return nil
}

func (l *AuditLogger) drain(ctx context.Context) error {
	l.mu.Lock()
	if len(l.queue) == 0 {
		l.mu.Unlock()
		return nil
	}
	batch := l.queue
	l.queue = make([]*models.AuditEvent, 0, len(batch))
	l.mu.Unlock()

	if err := l.flush(ctx, batch); err != nil {
		l.mu.Lock()
		l.queue = append(batch, l.queue...)
		l.mu.Unlock()
		l.log.Error("failed to write audit batch; will retry", zap.Error(err))
		return err
	}
	l.persistChain()
	return nil
}

func (l *AuditLogger) flush(ctx context.Context, batch []*models.AuditEvent) error {
	for _, s := range l.sinks {
		if err := s.Write(ctx, batch); err != nil {
			return err
		}
	}
	return nil
}

// persistChain writes the current chain hash to disk so integrity survives
// restarts. No-op when chain persistence is not configured.
func (l *AuditLogger) persistChain() {
	if l.chainFile == "" {
		return
	}
	// HashChain.previous is written by Log() under l.mu; read Current() under
	// the same lock so the background drain worker never races with a write.
	l.mu.Lock()
	current := l.chain.Current()
	l.mu.Unlock()
	if err := os.WriteFile(l.chainFile, []byte(current), 0o600); err != nil {
		l.log.Warn("failed to persist audit hash chain", zap.Error(err))
	}
}

// Flush forces any queued events to be written synchronously.
func (l *AuditLogger) Flush(ctx context.Context) error {
	return l.drain(ctx)
}

// Events returns a snapshot of the audited events from the in-memory sink,
// ordered oldest-first. It returns nil if no memory sink is configured. This
// is the canonical accessor for surfacing the hash-chained audit trail (e.g.
// via the management API) without coupling callers to a specific sink type.
func (l *AuditLogger) Events() []*models.AuditEvent {
	for _, s := range l.sinks {
		if ms, ok := s.(*MemorySink); ok {
			return ms.Events()
		}
	}
	return nil
}

// VerifyChain verifies hash-chain integrity across all memory sinks.
func (l *AuditLogger) VerifyChain() (bool, error) {
	for _, s := range l.sinks {
		if ms, ok := s.(*MemorySink); ok {
			events := ms.Events()
			okChain, _ := verifyChainIntegrity(events, l.seed)
			return okChain, nil
		}
	}
	// No in-memory sink configured: there is nothing to verify, so do not
	// report a misleading "verified" result.
	return false, nil
}

func cloneAuditEvent(event *models.AuditEvent) *models.AuditEvent {
	if event == nil {
		return nil
	}
	copy := *event
	if event.Details != nil {
		copy.Details = append([]byte(nil), event.Details...)
	}
	return &copy
}

// Close stops the flush worker, drains remaining events, and closes all sinks.
func (l *AuditLogger) Close() error {
	select {
	case <-l.stop:
		// already closed
	default:
		close(l.stop)
	}
	l.wg.Wait()
	l.drain(context.Background())
	for _, s := range l.sinks {
		_ = s.Close()
	}
	return nil
}
