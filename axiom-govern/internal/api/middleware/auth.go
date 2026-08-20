// Package middleware provides HTTP middleware for the management API.
package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"

	"github.com/laiw/management-harness/internal/core/models"
)

// AuthConfig configures the auth middleware.
type AuthConfig struct {
	JWTSecret  string
	AdminToken string
}

type ctxKey int

const identityCtxKey ctxKey = iota

// IdentityFromContext returns the authenticated identity set by JWTAuth.
func IdentityFromContext(ctx context.Context) (*models.Identity, bool) {
	id, ok := ctx.Value(identityCtxKey).(*models.Identity)
	return id, ok
}

// JWTAuth returns middleware that requires a valid JWT or admin token and
// stores the resolved identity (with roles) in the request context.
func JWTAuth(cfg AuthConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractBearer(r.Header.Get("Authorization"))
			if token == "" {
				unauthorized(w, "missing authorization")
				return
			}
			if cfg.AdminToken != "" && token == cfg.AdminToken {
				// Direct admin token: full privileges.
				ctx := context.WithValue(r.Context(), identityCtxKey, &models.Identity{
					UserID:  "admin",
					Roles:   []string{"admin"},
					IsAdmin: true,
				})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			if cfg.JWTSecret != "" {
				parsed, err := jwt.Parse(token, func(t *jwt.Token) (interface{}, error) {
					if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
						return nil, jwt.ErrSignatureInvalid
					}
					return []byte(cfg.JWTSecret), nil
				})
				if err == nil && parsed.Valid {
					identity := identityFromClaims(parsed.Claims.(jwt.MapClaims))
					ctx := context.WithValue(r.Context(), identityCtxKey, identity)
					next.ServeHTTP(w, r.WithContext(ctx))
					return
				}
			}
			unauthorized(w, "invalid token")
		})
	}
}

// identityFromClaims builds an Identity from JWT claims.
func identityFromClaims(claims jwt.MapClaims) *models.Identity {
	id := &models.Identity{}
	if v, ok := claims["sub"].(string); ok {
		id.UserID = v
	}
	if v, ok := claims["email"].(string); ok {
		id.Email = v
	}
	if v, ok := claims["roles"].([]interface{}); ok {
		for _, r := range v {
			if s, ok := r.(string); ok {
				id.Roles = append(id.Roles, s)
			}
		}
	}
	if v, ok := claims["admin"].(bool); ok {
		id.IsAdmin = v
	}
	if id.IsAdmin && len(id.Roles) == 0 {
		id.Roles = []string{"admin"}
	}
	if len(id.Roles) == 0 {
		id.Roles = []string{"viewer"}
	}
	return id
}

// RequireRole returns middleware that only allows principals with one of the
// given roles. It must run after JWTAuth.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id, ok := IdentityFromContext(r.Context())
			if !ok {
				forbidden(w, "missing identity")
				return
			}
			if !hasAnyRole(id, allowed) {
				forbidden(w, "insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAdmin allows only principals with the admin role.
func RequireAdmin() func(http.Handler) http.Handler {
	return RequireRole("admin")
}

func hasAnyRole(id *models.Identity, allowed map[string]bool) bool {
	if id.IsAdmin {
		return true
	}
	for _, r := range id.Roles {
		if allowed[r] {
			return true
		}
	}
	return false
}

func extractBearer(header string) string {
	if header == "" {
		return ""
	}
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer ")
	}
	return header
}

func unauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"unauthorized","message":"` + msg + `"}`))
}

func forbidden(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte(`{"error":"forbidden","message":"` + msg + `"}`))
}
