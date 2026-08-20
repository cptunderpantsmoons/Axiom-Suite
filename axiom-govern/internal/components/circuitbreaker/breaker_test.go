package circuitbreaker

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/laiw/management-harness/internal/core/models"
)

var boom = errors.New("boom")

type stubProvider struct {
	fail bool
}

func (s *stubProvider) ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error) {
	if s.fail {
		return nil, boom
	}
	return &models.ChatResponse{Model: req.Model}, nil
}
func (s *stubProvider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error) {
	if s.fail {
		return nil, boom
	}
	ch := make(chan *models.StreamChunk, 1)
	ch <- &models.StreamChunk{}
	close(ch)
	return ch, nil
}
func (s *stubProvider) Name() string                          { return "stub" }
func (s *stubProvider) HealthCheck(ctx context.Context) error { return nil }
func (s *stubProvider) EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error) {
	return 0.01, nil
}

// emptyStreamProvider returns a stream that yields no chunks (e.g. an upstream
// that errored after the HTTP 200).
type emptyStreamProvider struct{ stubProvider }

func (e *emptyStreamProvider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error) {
	ch := make(chan *models.StreamChunk)
	close(ch)
	return ch, nil
}

func TestBreakerTripsAfterFailures(t *testing.T) {
	stub := &stubProvider{fail: true}
	var states []State
	b := Wrap("stub", stub, Config{MaxFailures: 3, Cooldown: 10 * time.Second}, func(_ string, s State) {
		states = append(states, s)
	})

	for i := 0; i < 3; i++ {
		if _, err := b.ChatCompletion(context.Background(), &models.ChatRequest{}); err == nil {
			t.Fatalf("expected failure on call %d", i)
		}
	}
	if b.State() != StateOpen {
		t.Fatalf("expected open, got %s", b.State())
	}
	if _, err := b.ChatCompletion(context.Background(), &models.ChatRequest{}); !errors.Is(err, ErrOpen) {
		t.Fatalf("expected ErrOpen when open, got %v", err)
	}
}

func TestBreakerClosesOnSuccess(t *testing.T) {
	stub := &stubProvider{fail: true}
	b := Wrap("stub", stub, Config{MaxFailures: 2, Cooldown: time.Nanosecond}, nil)

	// Trip it.
	b.ChatCompletion(context.Background(), &models.ChatRequest{})
	b.ChatCompletion(context.Background(), &models.ChatRequest{})
	if b.State() != StateOpen {
		t.Fatalf("expected open after failures")
	}

	// Recover by succeeding: the short cooldown lets the next call probe.
	stub.fail = false
	if _, err := b.ChatCompletion(context.Background(), &models.ChatRequest{}); err != nil {
		t.Fatalf("expected success to probe, got %v", err)
	}
	if b.State() != StateClosed {
		t.Fatalf("expected closed after success, got %s", b.State())
	}
}

func TestBreakerStreamFailures(t *testing.T) {
	stub := &stubProvider{fail: true}
	b := Wrap("stub", stub, Config{MaxFailures: 2, Cooldown: time.Nanosecond}, nil)
	if _, err := b.ChatCompletionStream(context.Background(), &models.ChatRequest{}); !errors.Is(err, boom) {
		t.Fatalf("expected start error")
	}
	// A streaming call that yields no chunks counts as a failure.
	empty := &emptyStreamProvider{}
	b2 := Wrap("empty", empty, Config{MaxFailures: 1, Cooldown: time.Nanosecond}, nil)
	ch, err := b2.ChatCompletionStream(context.Background(), &models.ChatRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Drain: the channel is empty because the delegate yields nothing.
	for range ch {
	}
	if b2.State() != StateOpen {
		t.Fatalf("expected open after zero-chunk stream, got %s", b2.State())
	}
}

func TestHealthCheckBypassesBreaker(t *testing.T) {
	stub := &stubProvider{fail: true}
	b := Wrap("stub", stub, Config{MaxFailures: 1, Cooldown: 0}, nil)
	// Health checks must never trip or be blocked by the breaker.
	if err := b.HealthCheck(context.Background()); err != nil {
		t.Fatalf("unexpected health error: %v", err)
	}
	if b.State() != StateClosed {
		t.Fatalf("health check should not affect breaker state")
	}
}
