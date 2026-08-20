// Package api implements the Management Harness management REST API.
package api

import (
	"encoding/base64"
	"net/http"

	"github.com/laiw/management-harness/internal/components/provenance"
)

// SignedRequest is the request shape for the provenance sign/verify endpoints.
type SignedRequest struct {
	Source        provenance.Source `json:"source"`
	PayloadBase64 string            `json:"payload_base64"`
	Record        *provenance.Record `json:"record"`
}

// handleProvenanceInfo exposes the verifier's public key for enterprise
// configuration (who to trust when verifying ingested data).
func (s *Server) handleProvenanceInfo(w http.ResponseWriter, r *http.Request) {
	if s.deps == nil || len(s.deps.ProvenancePublicKey) == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provenance signer unavailable"})
		return
	}
	pub := s.deps.ProvenancePublicKey
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"signer_id":         provenance.SignerID,
		"public_key":        base64.StdEncoding.EncodeToString(pub),
		"header":            provenance.HeaderName,
		"supported_sources": []string{string(provenance.SourceHuman), string(provenance.SourceModel), string(provenance.SourceUnknown)},
	})
}

// handleProvenanceSign signs a payload with an attested source.
func (s *Server) handleProvenanceSign(w http.ResponseWriter, r *http.Request) {
	var body SignedRequest
	if err := decodeJSONBody(r, &body); err != nil || body.PayloadBase64 == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "payload_base64 and source required"})
		return
	}
	if body.Source != provenance.SourceHuman && body.Source != provenance.SourceModel && body.Source != provenance.SourceUnknown {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "source must be human|model|unknown"})
		return
	}
	if s.deps == nil || s.deps.ProvenanceSigner == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provenance signer unavailable"})
		return
	}
	payload, err := base64.StdEncoding.DecodeString(body.PayloadBase64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid payload_base64"})
		return
	}
	rec, err := s.deps.ProvenanceSigner.Sign(r.Context(), body.Source, payload, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// handleProvenanceVerify verifies a signed record against a payload and reports
// the Proof-of-Human / Proof-of-Source verdict.
func (s *Server) handleProvenanceVerify(w http.ResponseWriter, r *http.Request) {
	var body SignedRequest
	if err := decodeJSONBody(r, &body); err != nil || body.Record == nil || body.PayloadBase64 == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "record and payload_base64 required"})
		return
	}
	payload, err := base64.StdEncoding.DecodeString(body.PayloadBase64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid payload_base64"})
		return
	}
	if s.deps == nil || len(s.deps.ProvenancePublicKey) == 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "provenance verifier unavailable"})
		return
	}
	vd := provenance.Verify(s.deps.ProvenancePublicKey, payload, body.Record)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"verdict":        vd,
		"proof_of_human": vd.HumanProof(),
	})
}