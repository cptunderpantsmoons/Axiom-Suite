// Package auth implements API key authentication for the Management Harness.
package auth

import (
	"context"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/laiw/management-harness/internal/core/interfaces"
	"github.com/laiw/management-harness/internal/core/models"
)

// IdentityMapper maps a stored API key to a runtime Identity.
type IdentityMapper interface {
	Map(ctx context.Context, key *models.APIKey) (*models.Identity, error)
}

// DefaultIdentityMapper builds an Identity directly from the API key metadata.
type DefaultIdentityMapper struct{}

// Map implements IdentityMapper.
func (DefaultIdentityMapper) Map(ctx context.Context, key *models.APIKey) (*models.Identity, error) {
	return &models.Identity{
		UserID:   key.UserID,
		TeamID:   key.TeamID,
		OrgID:    key.OrgID,
		APIKeyID: key.ID,
		Roles:    []string{"user"},
	}, nil
}

type ctxKey int

const identityCtxKey ctxKey = iota

// AuthGateway validates API keys and produces identities.
type AuthGateway struct {
	keyStore       interfaces.KeyStore
	cache          interfaces.Cache
	identityMapper IdentityMapper
	log            *zap.Logger
}

// NewAuthGateway constructs an AuthGateway.
func NewAuthGateway(keyStore interfaces.KeyStore, cache interfaces.Cache, mapper IdentityMapper) *AuthGateway {
	if mapper == nil {
		mapper = DefaultIdentityMapper{}
	}
	return &AuthGateway{
		keyStore:       keyStore,
		cache:          cache,
		identityMapper: mapper,
		log:            zap.L().Named("auth"),
	}
}

// Authenticate validates an API key and returns the resolved identity.
func (g *AuthGateway) Authenticate(ctx context.Context, apiKey string) (*models.Identity, error) {
	if !ValidateAPIKeyFormat(apiKey) {
		return nil, ErrKeyNotFound
	}
	key, err := g.keyStore.GetKey(ctx, apiKey)
	if err != nil {
		return nil, err
	}
	if key.Revoked {
		return nil, ErrKeyRevoked
	}
	if key.ExpiresAt != nil && key.ExpiresAt.Before(time.Now().UTC()) {
		return nil, ErrKeyExpired
	}
	identity, err := g.identityMapper.Map(ctx, key)
	if err != nil {
		return nil, err
	}
	// Best-effort last-used stamp.
	now := time.Now().UTC()
	key.LastUsed = &now
	return identity, nil
}

// IdentityFromContext extracts an Identity previously stored by the middleware.
func IdentityFromContext(ctx context.Context) (*models.Identity, bool) {
	id, ok := ctx.Value(identityCtxKey).(*models.Identity)
	return id, ok
}

// Middleware enforces API key authentication on protected routes.
func (g *AuthGateway) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, ok := TokenFromHeader(r.Header.Get("Authorization"))
		if !ok || raw == "" {
			writeUnauthorized(w, "missing or malformed Authorization header")
			return
		}
		identity, err := g.Authenticate(r.Context(), raw)
		if err != nil {
			g.log.Warn("authentication failed", zap.Error(err), zap.String("ip", r.RemoteAddr))
			writeUnauthorized(w, "invalid API key")
			return
		}
		ctx := context.WithValue(r.Context(), identityCtxKey, identity)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func writeUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_, _ = w.Write([]byte(`{"error":"unauthorized","message":"` + msg + `"}`))
}
