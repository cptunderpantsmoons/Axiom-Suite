package cache

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/core/models"
)

func TestMemoryCacheSetGetDelete(t *testing.T) {
	c := NewMemoryCache()
	ctx := context.Background()
	require.NoError(t, c.Set(ctx, "k", []byte("v"), 0))
	v, err := c.Get(ctx, "k")
	require.NoError(t, err)
	assert.Equal(t, "v", string(v))

	exists, _ := c.Exists(ctx, "k")
	assert.True(t, exists)
	require.NoError(t, c.Delete(ctx, "k"))
	_, err = c.Get(ctx, "k")
	assert.Error(t, err)
}

func TestResponseCacheRoundTrip(t *testing.T) {
	c := NewResponseCache(NewMemoryCache(), 0.98)
	ctx := context.Background()
	req := &models.ChatRequest{
		Model:    "gpt-4o",
		Messages: []models.Message{{Role: "user", Content: "hello"}},
	}
	resp := &models.ChatResponse{Model: "gpt-4o", Choices: []models.Choice{{Message: models.Message{Content: "hi"}}}}
	require.NoError(t, c.Set(ctx, req, resp))

	got, err := c.Get(ctx, req)
	require.NoError(t, err)
	assert.Equal(t, "hi", got.Response.Choices[0].Message.Content)
}
