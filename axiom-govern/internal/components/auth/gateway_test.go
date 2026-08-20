package auth

import (
	"context"
	"testing"

	"github.com/laiw/management-harness/internal/core/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateAndValidateKey(t *testing.T) {
	key, err := GenerateAPIKey()
	require.NoError(t, err)
	assert.True(t, ValidateAPIKeyFormat(key))
	assert.Equal(t, "hk_", key[:3])
	assert.True(t, len(key) > 8)
}

func TestHashIsStable(t *testing.T) {
	key, _ := GenerateAPIKey()
	assert.Equal(t, HashAPIKey(key), HashAPIKey(key))
	assert.NotEqual(t, HashAPIKey(key), HashAPIKey("hk_otherkey"))
}

func TestAuthenticateAndRevoke(t *testing.T) {
	store := NewMemoryKeyStore()
	raw, _ := GenerateAPIKey()
	key := &models.APIKey{
		ID:        "k1",
		KeyHash:   HashAPIKey(raw),
		Prefix:    PrefixOf(raw),
		UserID:    "u1",
		RateLimit: 60,
	}
	require.NoError(t, store.CreateKey(context.Background(), key))

	gw := NewAuthGateway(store, nil, nil)
	identity, err := gw.Authenticate(context.Background(), raw)
	require.NoError(t, err)
	assert.Equal(t, "u1", identity.UserID)

	require.NoError(t, store.RevokeKey(context.Background(), "k1"))
	_, err = gw.Authenticate(context.Background(), raw)
	assert.ErrorIs(t, err, ErrKeyRevoked)
}

func TestAuthenticateInvalidFormat(t *testing.T) {
	gw := NewAuthGateway(NewMemoryKeyStore(), nil, nil)
	_, err := gw.Authenticate(context.Background(), "not-a-key")
	assert.ErrorIs(t, err, ErrKeyNotFound)
}
