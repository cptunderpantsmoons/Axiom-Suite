// Package middleware provides HTTP middleware for the management API.
package middleware

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
)

const maxBuckets = 100_000

// RateLimiter is an in-memory token-bucket rate limiter per client address.
type RateLimiter struct {
	mu       sync.Mutex
	buckets  map[string]*bucket
	rate     int
	interval time.Duration
}

type bucket struct {
	tokens  int
	last    time.Time
	touched time.Time
}

// NewRateLimiter creates a rate limiter allowing rate requests per interval.
func NewRateLimiter(rate int, interval time.Duration) *RateLimiter {
	if rate < 1 {
		rate = 1
	}
	if interval <= 0 {
		interval = time.Minute
	}
	return &RateLimiter{
		buckets:  map[string]*bucket{},
		rate:     rate,
		interval: interval,
	}
}

// Middleware enforces the rate limit using a normalized network client address.
// Authentication tokens are intentionally not used as map keys: accepting an
// attacker-controlled header there would permit unbounded bucket creation.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.allow(clientKey(r)) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"error":"rate_limited"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func clientKey(r *http.Request) string {
	// Prefer the trusted client IP set by the ClientIP middleware (XFF only
	// honored from configured proxy CIDRs). Falls back to the TCP peer so the
	// limiter still works when the middleware is absent.
	if ip := chimw.GetClientIP(r.Context()); ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	if strings.TrimSpace(r.RemoteAddr) != "" {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return "unknown"
}

func (rl *RateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	if b, ok := rl.buckets[key]; ok {
		b.touched = now
		elapsed := now.Sub(b.last)
		added := int(elapsed / rl.interval)
		if added > 0 {
			b.tokens += added * rl.rate
			if b.tokens > rl.rate {
				b.tokens = rl.rate
			}
			b.last = b.last.Add(time.Duration(added) * rl.interval)
		}
		if b.tokens <= 0 {
			return false
		}
		b.tokens--
		return true
	}

	if len(rl.buckets) >= maxBuckets {
		rl.evictOldest(now)
	}
	rl.buckets[key] = &bucket{tokens: rl.rate - 1, last: now, touched: now}
	return true
}

func (rl *RateLimiter) evictOldest(now time.Time) {
	var oldestKey string
	var oldest time.Time
	for key, b := range rl.buckets {
		if now.Sub(b.touched) > 2*rl.interval {
			delete(rl.buckets, key)
			continue
		}
		if oldestKey == "" || b.touched.Before(oldest) {
			oldestKey, oldest = key, b.touched
		}
	}
	if oldestKey != "" {
		delete(rl.buckets, oldestKey)
	}
}
