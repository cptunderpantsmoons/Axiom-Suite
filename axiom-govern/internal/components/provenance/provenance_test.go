package provenance

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSignVerifyRoundTrip(t *testing.T) {
	sig, pub, err := GenerateSigner("s1")
	require.NoError(t, err)
	payload := []byte("enterprise record 123")
	rec, err := sig.Sign(context.Background(), SourceHuman, payload, nil)
	require.NoError(t, err)

	vd := Verify(pub, payload, rec)
	assert.True(t, vd.Valid)
	assert.Equal(t, SourceHuman, vd.Source)
	assert.Equal(t, "s1", vd.SignerID)
	assert.True(t, vd.HumanProof())
}

func TestVerifyRejectsTamperedPayload(t *testing.T) {
	sig, pub, _ := GenerateSigner("s1")
	rec, _ := sig.Sign(context.Background(), SourceHuman, []byte("original"), nil)
	vd := Verify(pub, []byte("different payload"), rec)
	assert.False(t, vd.Valid)
	assert.Equal(t, "content hash mismatch", vd.Reason)
}

func TestVerifyRejectsReattributedSource(t *testing.T) {
	sig, pub, _ := GenerateSigner("s1")
	rec, _ := sig.Sign(context.Background(), SourceHuman, []byte("x"), nil)
	rec.Attestation.Source = SourceModel // attacker relabels to dodge "proof of human"
	vd := Verify(pub, []byte("x"), rec)
	assert.False(t, vd.Valid) // source is inside the signed canonical bytes
}

func TestVerifyRejectsWrongKey(t *testing.T) {
	sig, _, _ := GenerateSigner("s1")
	_, pub2, _ := GenerateSigner("other")
	rec, _ := sig.Sign(context.Background(), SourceHuman, []byte("x"), nil)
	assert.False(t, Verify(pub2, []byte("x"), rec).Valid)
}

func TestHumanProofOnlyForHuman(t *testing.T) {
	sig, pub, _ := GenerateSigner("s1")
	human, _ := sig.Sign(context.Background(), SourceHuman, []byte("a"), nil)
	model, _ := sig.Sign(context.Background(), SourceModel, []byte("a"), nil)
	assert.True(t, Verify(pub, []byte("a"), human).HumanProof())
	assert.False(t, Verify(pub, []byte("a"), model).HumanProof())
}

func TestMiddleware(t *testing.T) {
	sig, pub, _ := GenerateSigner("s1")
	headerFor := func(t *testing.T, body string) string {
		rec, err := sig.Sign(context.Background(), SourceHuman, []byte(body), nil)
		require.NoError(t, err)
		b, _ := json.Marshal(rec)
		return base64.StdEncoding.EncodeToString(b)
	}

	var got *Verdict
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, _ = VerdictFromContext(r.Context())
		_, _ = w.Write([]byte("ok"))
	})

	// requireValid=false: verdict attached, request passes.
	h := Middleware(pub, false)(inner)
	body := "data row"
	req := httptest.NewRequest(http.MethodPost, "/ingest", bytes.NewReader([]byte(body)))
	req.Header.Set(HeaderName, headerFor(t, body))
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	assert.Equal(t, http.StatusOK, rr.Code)
	require.NotNil(t, got)
	assert.True(t, got.Valid)

	// requireValid=true with tampered body + stale header => fail-closed 403.
	h2 := Middleware(pub, true)(inner)
	req2 := httptest.NewRequest(http.MethodPost, "/ingest", bytes.NewReader([]byte("tampered")))
	req2.Header.Set(HeaderName, headerFor(t, "data row"))
	rr2 := httptest.NewRecorder()
	h2.ServeHTTP(rr2, req2)
	assert.Equal(t, http.StatusForbidden, rr2.Code)

	// No header: passes through.
	req3 := httptest.NewRequest(http.MethodPost, "/ingest", bytes.NewReader([]byte("plain")))
	rr3 := httptest.NewRecorder()
	h2.ServeHTTP(rr3, req3)
	assert.Equal(t, http.StatusOK, rr3.Code)
}