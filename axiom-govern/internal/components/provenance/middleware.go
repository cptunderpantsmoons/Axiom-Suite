package provenance

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
)

// HeaderName is the HTTP header carrying a base64-encoded provenance Record.
const HeaderName = "X-Helm-Provenance"

type ctxKey int

const verdictCtxKey ctxKey = iota

// VerdictFromContext returns a provenance Verdict attached by Middleware.
func VerdictFromContext(ctx context.Context) (*Verdict, bool) {
	v, ok := ctx.Value(verdictCtxKey).(*Verdict)
	return v, ok
}

// Middleware is a lightweight ingestion guard: if a request carries an
// X-Helm-Provenance header, it verifies the signed Record against the request
// body and attaches the Verdict to the context. When requireValid is true, a
// declared-but-invalid provenance is rejected with 403 (fail-closed).
// Body-only provenance is validated only for reported endpoint; data with a
// valid "human" attestation can be gated by callers via Verdict.HumanProof().
func Middleware(pub ed25519.PublicKey, requireValid bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := r.Header.Get(HeaderName)
			if raw == "" {
				next.ServeHTTP(w, r)
				return
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, `{"error":"read body"}`, http.StatusBadRequest)
				return
			}
			// Restore the body for downstream handlers.
			r.Body = io.NopCloser(bytes.NewReader(body))

			dec, err := base64.StdEncoding.DecodeString(raw)
			if err != nil {
				http.Error(w, `{"error":"bad provenance header"}`, http.StatusBadRequest)
				return
			}
			var rec Record
			if err := json.Unmarshal(dec, &rec); err != nil {
				http.Error(w, `{"error":"bad provenance record"}`, http.StatusBadRequest)
				return
			}
			vd := Verify(pub, body, &rec)
			ctx := context.WithValue(r.Context(), verdictCtxKey, vd)
			if requireValid && !vd.Valid {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":"invalid provenance","reason":"` + vd.Reason + `"}`))
				return
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}