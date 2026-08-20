// Package metrics provides Prometheus collectors for the Management Harness.
package metrics

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// MetricsCollector records request, token, cost, and threat metrics.
type MetricsCollector struct {
	reg *prometheus.Registry

	requestsTotal   *prometheus.CounterVec
	requestDuration *prometheus.HistogramVec
	tokensTotal     *prometheus.CounterVec
	costTotal       *prometheus.CounterVec
	threatsDetected *prometheus.CounterVec
	cacheHits       *prometheus.CounterVec
	breakerState    *prometheus.GaugeVec
	budgetExceeded  *prometheus.CounterVec
	optimizerApplied     *prometheus.CounterVec
	optimizerTokensSaved *prometheus.CounterVec
}

// NewMetricsCollector constructs a MetricsCollector and registers its metrics on
// a dedicated registry so exposition (Handler) is independent of the global
// default registry.
func NewMetricsCollector() *MetricsCollector {
	reg := prometheus.NewRegistry()

	m := &MetricsCollector{
		reg: reg,

		requestsTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "harness",
			Subsystem: "proxy",
			Name:      "requests_total",
			Help:      "Total number of proxied requests.",
		}, []string{"provider", "model", "status"}),

		requestDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: "harness",
			Subsystem: "proxy",
			Name:      "request_duration_seconds",
			Help:      "Latency of proxied requests.",
			Buckets:   prometheus.DefBuckets,
		}, []string{"provider", "model", "status"}),

		tokensTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "harness",
			Subsystem: "proxy",
			Name:      "tokens_total",
			Help:      "Total tokens processed.",
		}, []string{"provider", "model", "token_type"}),

		costTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "harness",
			Subsystem: "budget",
			Name:      "cost_total_usd",
			Help:      "Total estimated cost in USD.",
		}, []string{"user_id", "team_id", "provider"}),

		threatsDetected: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "harness",
			Subsystem: "guardian",
			Name:      "threats_detected_total",
			Help:      "Total threats detected by the guardian.",
		}, []string{"threat_type", "severity"}),

		cacheHits: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "harness",
			Subsystem: "cache",
			Name:      "cache_hits_total",
			Help:      "Total cache hits/misses.",
		}, []string{"result"}),

		breakerState: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Namespace: "harness",
			Subsystem: "provider",
			Name:      "circuit_breaker_state",
			Help:      "Circuit breaker state per provider (0=closed, 1=open, 2=half-open).",
		}, []string{"provider"}),

		budgetExceeded: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "harness",
			Subsystem: "proxy",
			Name:      "budget_exceeded_total",
			Help:      "Total requests rejected due to budget limits.",
		}, []string{"provider"}),

		optimizerApplied: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "harness",
			Subsystem: "optimizer",
			Name:      "applied_total",
			Help:      "Total times prompt optimisation was applied.",
		}, []string{"skill"}),

		optimizerTokensSaved: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "harness",
			Subsystem: "optimizer",
			Name:      "tokens_saved_total",
			Help:      "Approximate tokens saved by prompt optimisation.",
		}, []string{"skill"}),
	}

	reg.MustRegister(
		m.requestsTotal,
		m.requestDuration,
		m.tokensTotal,
		m.costTotal,
		m.threatsDetected,
		m.cacheHits,
		m.breakerState,
		m.budgetExceeded,
		m.optimizerApplied,
		m.optimizerTokensSaved,
	)
	return m
}

// RecordRequest records request count and latency.
func (m *MetricsCollector) RecordRequest(provider, model, status string, duration time.Duration) {
	m.requestsTotal.WithLabelValues(provider, model, status).Inc()
	m.requestDuration.WithLabelValues(provider, model, status).Observe(duration.Seconds())
}

// RecordTokens records token usage.
func (m *MetricsCollector) RecordTokens(provider, model, tokenType string, count int) {
	m.tokensTotal.WithLabelValues(provider, model, tokenType).Add(float64(count))
}

// RecordCost records cost in USD.
func (m *MetricsCollector) RecordCost(userID, teamID, provider string, cost float64) {
	m.costTotal.WithLabelValues(userID, teamID, provider).Add(cost)
}

// RecordThreat records a detected threat.
func (m *MetricsCollector) RecordThreat(threatType string, severity string) {
	m.threatsDetected.WithLabelValues(threatType, severity).Inc()
}

// RecordCache records a cache hit/miss.
func (m *MetricsCollector) RecordCache(result string) {
	m.cacheHits.WithLabelValues(result).Inc()
}

// SetBreakerState publishes the circuit breaker state for a provider
// (0=closed, 1=open, 2=half-open).
func (m *MetricsCollector) SetBreakerState(provider string, state int) {
	m.breakerState.WithLabelValues(provider).Set(float64(state))
}

// RecordBudgetExceeded increments the budget-rejection counter.
func (m *MetricsCollector) RecordBudgetExceeded(provider string) {
	m.budgetExceeded.WithLabelValues(provider).Inc()
}

// RecordOptimization records a prompt optimisation application and the
// approximate number of tokens saved (for the given skill, "" for global).
func (m *MetricsCollector) RecordOptimization(skill string, tokensSaved int) {
	m.optimizerApplied.WithLabelValues(skill).Inc()
	m.optimizerTokensSaved.WithLabelValues(skill).Add(float64(tokensSaved))
}

// Handler returns the Prometheus metrics HTTP handler for this collector.
func (m *MetricsCollector) Handler() http.Handler {
	return promhttp.HandlerFor(m.reg, promhttp.HandlerOpts{})
}
