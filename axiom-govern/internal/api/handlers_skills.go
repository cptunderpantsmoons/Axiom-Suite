// Package api implements the Management Harness management REST API.
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/laiw/management-harness/internal/core/config"
	"github.com/laiw/management-harness/internal/core/models"
)

func (s *Server) handleListSkills(w http.ResponseWriter, r *http.Request) {
	if s.deps == nil || s.deps.SkillStore == nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"skills": []*models.Skill{}})
		return
	}
	m := s.deps.SkillStore.Get()
	out := make([]*models.Skill, 0, len(m))
	for _, sk := range m {
		out = append(out, sk)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	writeJSON(w, http.StatusOK, map[string]interface{}{"skills": out})
}

func (s *Server) handleGetSkill(w http.ResponseWriter, r *http.Request) {
	name := chiID(r, "name")
	if s.deps == nil || s.deps.SkillStore == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "skill not found"})
		return
	}
	sk := s.deps.SkillStore.Get()[name]
	if sk == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "skill not found"})
		return
	}
	writeJSON(w, http.StatusOK, sk)
}

func (s *Server) handleCreateSkill(w http.ResponseWriter, r *http.Request) {
	var skill models.Skill
	if err := decodeJSONBody(r, &skill); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	if skill.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	if skill.Version == "" {
		skill.Version = "1"
	}
	now := time.Now().UTC()
	skill.CreatedAt = now
	skill.UpdatedAt = now

	cur := s.deps.SkillStore.Get()
	if _, exists := cur[skill.Name]; exists {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "skill already exists"})
		return
	}
	cur[skill.Name] = &skill
	if err := s.saveSkills(cur); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.auditEvent(r, "admin.skill.create", "/api/v1/skills/"+skill.Name, "success")
	writeJSON(w, http.StatusCreated, skill)
}

func (s *Server) handleUpdateSkill(w http.ResponseWriter, r *http.Request) {
	name := chiID(r, "name")
	var skill models.Skill
	if err := decodeJSONBody(r, &skill); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	skill.Name = name
	cur := s.deps.SkillStore.Get()
	existing, ok := cur[name]
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "skill not found"})
		return
	}
	skill.CreatedAt = existing.CreatedAt
	if skill.Version == "" {
		skill.Version = existing.Version
	}
	skill.UpdatedAt = time.Now().UTC()
	cur[name] = &skill
	if err := s.saveSkills(cur); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.auditEvent(r, "admin.skill.update", "/api/v1/skills/"+name, "success")
	writeJSON(w, http.StatusOK, skill)
}

func (s *Server) handleDeleteSkill(w http.ResponseWriter, r *http.Request) {
	name := chiID(r, "name")
	cur := s.deps.SkillStore.Get()
	if _, ok := cur[name]; !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "skill not found"})
		return
	}
	delete(cur, name)
	if err := s.saveSkills(cur); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.auditEvent(r, "admin.skill.delete", "/api/v1/skills/"+name, "success")
	w.WriteHeader(http.StatusNoContent)
}

const defaultNemotronModel = "nvidia/nemotron-3.5-lightning-30b-a3b"

// handleDraftSkill uses the configured LLM provider (e.g. NVIDIA Nemotron) to
// draft a Skill from a plain-language description. The result is returned for
// review/editing — it is NOT persisted here.
func (s *Server) handleDraftSkill(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Description string `json:"description"`
	}
	if err := decodeJSONBody(r, &body); err != nil || strings.TrimSpace(body.Description) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "description is required"})
		return
	}
	sk, err := s.draftSkill(r, body.Description)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to draft skill: " + err.Error()})
		return
	}
	s.auditEvent(r, "admin.skill.draft", "/api/v1/skills/draft", "success")
	writeJSON(w, http.StatusOK, sk)
}

// draftSkill calls the optimizer LLM provider to generate a Skill definition.
func (s *Server) draftSkill(r *http.Request, description string) (*models.Skill, error) {
	if s.deps == nil || s.deps.Config == nil || s.deps.Providers == nil {
		return nil, errors.New("skill drafting is unavailable (no provider registry)")
	}
	providers := s.deps.Providers.Snapshot()
	oc := s.optimizerConfig()
	provider := providers[oc.Provider]
	if provider == nil {
		for _, p := range providers {
			provider = p
			break
		}
	}
	if provider == nil {
		return nil, errors.New("no LLM provider configured for skill drafting")
	}
	model := oc.Model
	if model == "" {
		model = defaultNemotronModel
	}

	sys := "You are an expert prompt engineer. Given a task description, produce a " +
		"reusable skill as valid JSON with exactly these fields: name (snake_case), " +
		"description, system_prompt (concise instruction), template (user prompt with " +
		"{{slot}} placeholders), and parameters (array of {name, type: string|int|bool|enum, " +
		"required (bool), default, enum (array, optional), description}). " +
		"Return ONLY the JSON object; no prose and no markdown fences."
	maxTokens := 2048
	resp, err := provider.ChatCompletion(r.Context(), &models.ChatRequest{
		Model: model,
		Messages: []models.Message{
			{Role: "system", Content: sys},
			{Role: "user", Content: description},
		},
		MaxTokens: &maxTokens,
	})
	if err != nil {
		return nil, err
	}
	if len(resp.Choices) == 0 {
		return nil, errors.New("empty drafting completion")
	}
	content := stripCodeFences(resp.Choices[0].Message.Content)
	var sk models.Skill
	if err := json.Unmarshal([]byte(content), &sk); err != nil {
		return nil, errors.New("draft was not valid skill JSON: " + err.Error())
	}
	if sk.Name == "" {
		sk.Name = derivedName(description)
	}
	return &sk, nil
}

// stripCodeFences removes ```json ... ``` fences some models wrap output in.
func stripCodeFences(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")
	return strings.TrimSpace(s)
}

// derivedName returns a snake_case slug from the description's leading words.
func derivedName(desc string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(desc) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else if r == ' ' || r == '-' {
			b.WriteByte('_')
		}
	}
	raw := strings.Join(strings.FieldsFunc(b.String(), func(r rune) bool { return r == '_' }), "_")
	raw = strings.Trim(raw, "_")
	if raw == "" {
		return "skill"
	}
	if len(raw) > 24 {
		raw = raw[:24]
	}
	return strings.Trim(raw, "_")
}

// optimizerConfig returns the dashboard-editable optimizer settings, preferring
// the runtime store (live dashboard saves) and falling back to static config.
func (s *Server) optimizerConfig() config.OptimizerConfig {
	if s.deps != nil && s.deps.RuntimeStore != nil && s.deps.RuntimeStore.Exists() {
		if rt := s.deps.RuntimeStore.Get().Optimizer; rt != nil {
			return config.OptimizerConfig{Enabled: rt.Enabled, Provider: rt.Provider, Model: rt.Model, ShadowMode: rt.ShadowMode}
		}
	}
	return s.deps.Config.Optimizer
}

func (s *Server) saveSkills(updated map[string]*models.Skill) error {
	if err := s.deps.SkillStore.Save(updated); err != nil {
		return err
	}
	if s.deps.Skills != nil {
		s.deps.Skills.Replace(updated)
	}
	return nil
}