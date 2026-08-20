package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
)

// TestClientKeyIgnoresSpoofedForwardedHeaders verifies that with no trusted
// proxies configured, the limiter keys on the TCP peer address and cannot be
// bypassed by rotating X-Forwarded-For values.
func TestClientKeyIgnoresSpoofedForwardedHeaders(t *testing.T) {
	rl := NewRateLimiter(2, time.Minute)
	handler := chimw.ClientIPFromRemoteAddr(rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	req := func(xff string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = "198.51.100.7:1234"
		if xff != "" {
			r.Header.Set("X-Forwarded-For", xff)
		}
		return r
	}

	for _, xff := range []string{"203.0.113.1", "203.0.113.2"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req(xff))
		if rec.Code != http.StatusOK {
			t.Fatalf("expected OK for spoofed XFF %q, got %d", xff, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req("203.0.113.3"))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 (shared bucket), got %d", rec.Code)
	}
}

// TestClientKeyTrustsConfiguredProxyCIDR verifies that a trusted proxy CIDR is
// honored so distinct clients behind the proxy get distinct buckets.
func TestClientKeyTrustsConfiguredProxyCIDR(t *testing.T) {
	rl := NewRateLimiter(2, time.Minute)
	handler := chimw.ClientIPFromXFF("198.51.100.0/24")(rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	req := func(xff string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = "198.51.100.1:1234" // the trusted proxy
		r.Header.Set("X-Forwarded-For", xff)
		return r
	}

	for _, xff := range []string{"203.0.113.1", "203.0.113.2"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req(xff))
		if rec.Code != http.StatusOK {
			t.Fatalf("expected OK for client %q, got %d", xff, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req("203.0.113.1"))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected OK for repeated client, got %d", rec.Code)
	}
}
