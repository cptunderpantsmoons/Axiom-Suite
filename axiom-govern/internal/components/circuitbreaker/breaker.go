// Package circuitbreaker wraps LLM providers with a failure-tripping breaker so
// a misbehaving or down upstream is bypassed quickly instead of hanging requests.
package circuitbreaker

import (
	"context"
	"errors"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

// State is the breaker state.
type State int

const (
	// StateClosed allows traffic and counts failures.
	StateClosed State = iota
	// StateOpen rejects traffic until the cooldown elapses.
	StateOpen
	// StateHalfOpen probes a single request to decide recovery.
	StateHalfOpen
)

func (s State) String() string {
	switch s {
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "closed"
	}
}

// ErrOpen is returned when the breaker is open and rejects the call.
var ErrOpen = errors.New("circuit breaker open")

// Config tunes the breaker behaviour.
type Config struct {
	// MaxFailures is the number of consecutive failures that trips the breaker.
	MaxFailures int
	// Cooldown is how long the breaker stays open before probing half-open.
	Cooldown time.Duration
}

// DefaultConfig is a sensible production default.
func DefaultConfig() Config {
	return Config{MaxFailures: 5, Cooldown: 10 * time.Second}
}

// StateReporter is notified whenever a breaker changes state (for metrics).
type StateReporter func(provider string, state State)

// Provider decorates an interfaces.LLMProvider with a circuit breaker.
type Provider struct {
	delegate interfaces.LLMProvider
	cfg      Config
	reporter StateReporter
	log      *zap.Logger

	mu       sync.Mutex
	state    State
	failures int
	openedAt time.Time
}

// Wrap decorates p with a circuit breaker.
func Wrap(name string, p interfaces.LLMProvider, cfg Config, reporter StateReporter) *Provider {
	if cfg.MaxFailures <= 0 {
		cfg.MaxFailures = DefaultConfig().MaxFailures
	}
	if cfg.Cooldown <= 0 {
		cfg.Cooldown = DefaultConfig().Cooldown
	}
	return &Provider{
		delegate: p,
		cfg:      cfg,
		reporter: reporter,
		log:      zap.L().Named("circuitbreaker").With(zap.String("provider", name)),
		state:    StateClosed,
	}
}

// allow reports whether a call should be attempted and (in half-open) consumes
// the single probe slot.
func (b *Provider) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	switch b.state {
	case StateOpen:
		if time.Since(b.openedAt) >= b.cfg.Cooldown {
			b.state = StateHalfOpen
			return true
		}
		return false
	default:
		return true
	}
}

func (b *Provider) recordSuccess() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.state != StateClosed {
		b.state = StateClosed
		b.failures = 0
		b.report()
		b.log.Info("circuit breaker closed")
	}
}

func (b *Provider) recordFailure() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.failures++
	if b.state == StateHalfOpen || b.failures >= b.cfg.MaxFailures {
		b.state = StateOpen
		b.openedAt = time.Now()
		b.report()
		b.log.Warn("circuit breaker opened", zap.Int("failures", b.failures))
	}
}

func (b *Provider) report() {
	if b.reporter != nil {
		b.reporter(b.delegate.Name(), b.state)
	}
}

// State returns the current breaker state (safe for metrics scraping).
func (b *Provider) State() State {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.state
}

// Config returns a copy of the breaker configuration (useful for inspection/tests).
func (b *Provider) Config() Config {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cfg
}

// Name returns the underlying provider name.
func (b *Provider) Name() string { return b.delegate.Name() }

// ChatCompletion runs the breaker around a non-streaming completion.
func (b *Provider) ChatCompletion(ctx context.Context, req *models.ChatRequest) (*models.ChatResponse, error) {
	if !b.allow() {
		return nil, ErrOpen
	}
	resp, err := b.delegate.ChatCompletion(ctx, req)
	if err != nil {
		b.recordFailure()
		return nil, err
	}
	b.recordSuccess()
	return resp, nil
}

// ChatCompletionStream runs the breaker around a streaming completion. The
// returned channel is wrapped so a closed-without-data stream counts as a
// failure; a channel that yields at least one chunk counts as a success.
func (b *Provider) ChatCompletionStream(ctx context.Context, req *models.ChatRequest) (<-chan *models.StreamChunk, error) {
	if !b.allow() {
		return nil, ErrOpen
	}
	ch, err := b.delegate.ChatCompletionStream(ctx, req)
	if err != nil {
		b.recordFailure()
		return nil, err
	}
	out := make(chan *models.StreamChunk, 64)
	go func() {
		defer close(out)
		delivered := false
		for chunk := range ch {
			delivered = true
			select {
			case out <- chunk:
			case <-ctx.Done():
				b.recordFailure()
				return
			}
		}
		if delivered {
			b.recordSuccess()
		} else {
			b.recordFailure()
		}
	}()
	return out, nil
}

// HealthCheck bypasses the breaker: probing must never trip or heal it.
func (b *Provider) HealthCheck(ctx context.Context) error { return b.delegate.HealthCheck(ctx) }

// EstimateCost bypasses the breaker.
func (b *Provider) EstimateCost(ctx context.Context, req *models.ChatRequest) (float64, error) {
	return b.delegate.EstimateCost(ctx, req)
}

var _ interfaces.LLMProvider = (*Provider)(nil)
