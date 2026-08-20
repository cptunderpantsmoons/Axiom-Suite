// Package api implements the Management Harness management REST API.
package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
)

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := s.users.List(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"users": users})
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request) {
	var u User
	if err := decodeJSONBody(r, &u); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if u.ID == "" {
		u.ID = uuid.NewString()
	}
	if u.CreatedAt == "" {
		u.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if len(u.Roles) == 0 {
		u.Roles = []string{"user"}
	}
	if err := s.users.Create(r.Context(), &u); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.auditEvent(r, "admin.user.create", "/api/v1/users", "success")
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) handleGetUser(w http.ResponseWriter, r *http.Request) {
	id := chiID(r, "id")
	u, err := s.users.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "user not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleUpdateUser(w http.ResponseWriter, r *http.Request) {
	id := chiID(r, "id")
	var u User
	if err := decodeJSONBody(r, &u); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	u.ID = id
	if err := s.users.Update(r.Context(), &u); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.auditEvent(r, "admin.user.update", "/api/v1/users/"+id, "success")
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := chiID(r, "id")
	if err := s.users.Delete(r.Context(), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.auditEvent(r, "admin.user.delete", "/api/v1/users/"+id, "success")
	w.WriteHeader(http.StatusNoContent)
}
