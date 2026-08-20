package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/laiw/management-harness/internal/core/models"
)

func reqWithIdentity(id *models.Identity) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	if id != nil {
		r = r.WithContext(context.WithValue(r.Context(), identityCtxKey, id))
	}
	return r
}

func TestRequireRoleAllowsAndDenies(t *testing.T) {
	allow := RequireRole("admin")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

	// Admin is allowed.
	rec := httptest.NewRecorder()
	allow.ServeHTTP(rec, reqWithIdentity(&models.Identity{UserID: "a", Roles: []string{"admin"}, IsAdmin: true}))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin should be allowed, got %d", rec.Code)
	}

	// Viewer is denied.
	rec = httptest.NewRecorder()
	allow.ServeHTTP(rec, reqWithIdentity(&models.Identity{UserID: "v", Roles: []string{"viewer"}}))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("viewer should be forbidden, got %d", rec.Code)
	}

	// Missing identity is forbidden.
	rec = httptest.NewRecorder()
	allow.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing identity should be forbidden, got %d", rec.Code)
	}
}

func TestIdentityFromClaims(t *testing.T) {
	claims := map[string]interface{}{
		"sub":   "user-1",
		"email": "u@example.com",
		"roles": []interface{}{"viewer"},
	}
	id := identityFromClaims(claims)
	if id.UserID != "user-1" || id.Email != "u@example.com" {
		t.Fatalf("unexpected identity: %+v", id)
	}
	if len(id.Roles) != 1 || id.Roles[0] != "viewer" {
		t.Fatalf("expected viewer role, got %+v", id.Roles)
	}
	if id.IsAdmin {
		t.Fatalf("viewer should not be admin")
	}

	adminClaims := map[string]interface{}{"admin": true}
	admin := identityFromClaims(adminClaims)
	if !admin.IsAdmin {
		t.Fatalf("admin claim should set IsAdmin")
	}
}
