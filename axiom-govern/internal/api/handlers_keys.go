// Package api implements the Management Harness management REST API.
package api

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/laiw/management-harness/internal/components/auth"
	"github.com/laiw/management-harness/internal/core/models"
)

func (s *Server) handleListKeys(w http.ResponseWriter, r *http.Request) {
	id := chiID(r, "id")
	keys, err := s.deps.KeyStore.ListKeys(r.Context(), id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"keys": keys})
}

func (s *Server) handleCreateKey(w http.ResponseWriter, r *http.Request) {
	id := chiID(r, "id")
	raw, err := auth.GenerateAPIKey()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	now := time.Now().UTC()
	key := &models.APIKey{
		ID:        uuid.NewString(),
		KeyHash:   auth.HashAPIKey(raw),
		Prefix:    auth.PrefixOf(raw),
		UserID:    id,
		CreatedAt: now,
		RateLimit: 60,
	}
	if err := s.deps.KeyStore.CreateKey(r.Context(), key); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.auditEvent(r, "admin.key.create", "/api/v1/users/"+id+"/keys", "success")
	// Return the raw key exactly once.
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":         key.ID,
		"prefix":     key.Prefix,
		"api_key":    raw,
		"rate_limit": key.RateLimit,
	})
}

func (s *Server) handleRevokeKey(w http.ResponseWriter, r *http.Request) {
	keyID := chiID(r, "key_id")
	if err := s.deps.KeyStore.RevokeKey(r.Context(), keyID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.auditEvent(r, "admin.key.revoke", "/api/v1/keys/"+keyID, "success")
	w.WriteHeader(http.StatusNoContent)
}
