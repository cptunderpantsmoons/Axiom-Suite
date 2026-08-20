package skills

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/laiw/management-harness/internal/core/models"
)

func testSkill() *models.Skill {
	return &models.Skill{
		Name:         "summarize",
		Version:      "1",
		SystemPrompt: "You are a concise summarizer.",
		Template:     "Summarize {{text}} for {{audience}}.",
		Parameters: []models.SkillParam{
			{Name: "text", Type: "string", Required: true, MaxLength: 1000},
			{Name: "audience", Type: "enum", Enum: []any{"partner", "associate"}, Default: "partner"},
		},
	}
}

func TestExpandFillsSlots(t *testing.T) {
	msgs, err := Expand(testSkill(), map[string]any{"text": "The quarterly report", "audience": "associate"})
	require.NoError(t, err)
	require.Len(t, msgs, 2)
	assert.Equal(t, "system", msgs[0].Role)
	assert.Equal(t, "You are a concise summarizer.", msgs[0].Content)
	assert.Equal(t, "user", msgs[1].Role)
	assert.Equal(t, "Summarize The quarterly report for associate.", msgs[1].Content)
}

func TestExpandUsesDefault(t *testing.T) {
	msgs, err := Expand(testSkill(), map[string]any{"text": "x"})
	require.NoError(t, err)
	assert.Equal(t, "Summarize x for partner.", msgs[1].Content)
}

func TestExpandRejectsUnknownSlot(t *testing.T) {
	sk := testSkill()
	sk.Template = "Use {{text}} and {{bogus}}"
	_, err := Expand(sk, map[string]any{"text": "x"})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrUnknownSlot)
}

func TestExpandRequiresRequiredParam(t *testing.T) {
	_, err := Expand(testSkill(), map[string]any{"audience": "partner"})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrMissingParam)
}

func TestExpandEnforcesEnum(t *testing.T) {
	_, err := Expand(testSkill(), map[string]any{"text": "x", "audience": "bogus"})
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrInvalidParam)
}

func TestExpandEnforcesMaxLength(t *testing.T) {
	_, err := Expand(testSkill(), map[string]any{"text": string(make([]byte, 2000))})
	require.Error(t, err)
}

func TestAuthorize(t *testing.T) {
	sk := testSkill()
	sk.Public = false
	sk.Owner = "legal"
	sk.Teams = []string{"ops"}

	legal := &models.Identity{TeamID: "legal"}
	ops := &models.Identity{TeamID: "ops"}
	other := &models.Identity{TeamID: "sales"}
	admin := &models.Identity{IsAdmin: true}

	assert.True(t, Authorize(sk, legal))
	assert.True(t, Authorize(sk, ops))
	assert.False(t, Authorize(sk, other))
	assert.True(t, Authorize(sk, admin))
	assert.False(t, Authorize(sk, nil))

	sk.Public = true
	assert.True(t, Authorize(sk, other))
}

func TestEngineResolveStripsVersion(t *testing.T) {
	sk := testSkill()
	sk.Public = true
	reg := NewRegistry(map[string]*models.Skill{"summarize": sk})
	e := NewEngine(reg)
	got, err := e.Resolve("summarize@9", &models.Identity{TeamID: "legal"})
	require.NoError(t, err)
	assert.Equal(t, "summarize", got.Name)

	_, err = e.Resolve("missing", &models.Identity{TeamID: "legal"})
	assert.ErrorIs(t, err, ErrNotFound)
}