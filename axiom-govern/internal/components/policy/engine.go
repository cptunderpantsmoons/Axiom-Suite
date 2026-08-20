// Package policy implements rule-based policy evaluation.
package policy

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/laiw/management-harness/internal/core/models"
)

// PolicyLoader loads policies from a source.
type PolicyLoader interface {
	Load() (*models.Policy, error)
}

// FileLoader loads a policy from a YAML file.
type FileLoader struct {
	path string
}

// NewFileLoader constructs a file-backed policy loader.
func NewFileLoader(path string) *FileLoader {
	return &FileLoader{path: path}
}

// Load reads and parses the policy YAML.
func (l *FileLoader) Load() (*models.Policy, error) {
	data, err := os.ReadFile(l.path)
	if err != nil {
		return nil, err
	}
	var p models.Policy
	if err := yaml.Unmarshal(data, &p); err != nil {
		return nil, err
	}
	return &p, nil
}

// Watch polls the file for changes and invokes onChange when the mtime changes.
func (l *FileLoader) Watch(ctx context.Context, onChange func(*models.Policy)) {
	var lastMod time.Time
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			info, err := os.Stat(l.path)
			if err != nil {
				continue
			}
			if info.ModTime().After(lastMod) {
				lastMod = info.ModTime()
				p, err := l.Load()
				if err != nil {
					continue
				}
				onChange(p)
			}
		case <-ctx.Done():
			return
		}
	}
}

// PolicyResult is the outcome of policy evaluation.
type PolicyResult struct {
	Allowed bool                   `json:"allowed"`
	Action  string                 `json:"action"`
	Message string                 `json:"message,omitempty"`
	Params  map[string]interface{} `json:"params,omitempty"`
}

// PolicyEngine evaluates rules against requests.
type PolicyEngine struct {
	loader PolicyLoader
	rules  []models.Rule
	mu     sync.RWMutex
}

// NewPolicyEngine constructs a PolicyEngine from a loader.
func NewPolicyEngine(loader PolicyLoader) *PolicyEngine {
	e := &PolicyEngine{loader: loader}
	if loader != nil {
		if p, err := loader.Load(); err == nil {
			e.rules = p.Rules
		}
	}
	return e
}

// Reload replaces the active rules.
func (e *PolicyEngine) Reload(p *models.Policy) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.rules = p.Rules
}

// Evaluate runs all rules (priority order) and returns the first decisive action.
func (e *PolicyEngine) Evaluate(ctx context.Context, req *models.ChatRequest, identity *models.Identity) (*PolicyResult, error) {
	e.mu.RLock()
	rules := make([]models.Rule, len(e.rules))
	copy(rules, e.rules)
	e.mu.RUnlock()

	sorted := append([]models.Rule{}, rules...)
	sortRules(sorted)

	env := buildEnv(req, identity)
	for _, rule := range sorted {
		matched, err := matchCondition(rule.Condition, env)
		if err != nil {
			continue
		}
		if matched {
			switch rule.Action {
			case "allow":
				return &PolicyResult{Allowed: true, Action: "allow", Message: rule.Message, Params: rule.Params}, nil
			case "block":
				return &PolicyResult{Allowed: false, Action: "block", Message: rule.Message, Params: rule.Params}, nil
			case "redact", "route":
				return &PolicyResult{Allowed: true, Action: rule.Action, Message: rule.Message, Params: rule.Params}, nil
			}
		}
	}
	return &PolicyResult{Allowed: true, Action: "allow"}, nil
}

func buildEnv(req *models.ChatRequest, identity *models.Identity) map[string]interface{} {
	env := map[string]interface{}{
		"model": req.Model,
	}
	if len(req.Messages) > 0 {
		env["role"] = req.Messages[len(req.Messages)-1].Role
		env["content"] = req.Messages[len(req.Messages)-1].Content
	}
	if req.MaxTokens != nil {
		env["max_tokens"] = *req.MaxTokens
	}
	if identity != nil {
		env["role"] = firstOrEmpty(identity.Roles)
		env["team_id"] = identity.TeamID
		env["org_id"] = identity.OrgID
	}
	return env
}

func firstOrEmpty(s []string) string {
	if len(s) == 0 {
		return ""
	}
	return s[0]
}

// matchCondition supports simple "<field> <op> <value>" expressions.
func matchCondition(cond string, env map[string]interface{}) (bool, error) {
	if cond == "" {
		return true, nil
	}
	ops := []string{"==", "!=", ">=", "<=", ">", "<", "contains"}
	for _, op := range ops {
		idx := strings.Index(cond, op)
		if idx < 0 {
			continue
		}
		field := strings.TrimSpace(cond[:idx])
		val := strings.TrimSpace(cond[idx+len(op):])
		val = strings.Trim(val, `"'`)
		switch op {
		case "==":
			return toString(env[field]) == val, nil
		case "!=":
			return toString(env[field]) != val, nil
		case "contains":
			return strings.Contains(toString(env[field]), val), nil
		case ">", "<", ">=", "<=":
			lv, rv := toFloat(env[field]), toFloat(val)
			switch op {
			case ">":
				return lv > rv, nil
			case "<":
				return lv < rv, nil
			case ">=":
				return lv >= rv, nil
			case "<=":
				return lv <= rv, nil
			}
		}
	}
	return false, nil
}

func toString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return ""
	default:
		b, _ := json.Marshal(t)
		return string(b)
	}
}

func toFloat(v interface{}) float64 {
	switch t := v.(type) {
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case float64:
		return t
	case string:
		var f float64
		_, _ = fmt.Sscan(t, &f)
		return f
	default:
		return 0
	}
}

func sortRules(rules []models.Rule) {
	// Simple insertion sort to avoid importing sort for a small slice.
	for i := 1; i < len(rules); i++ {
		for j := i; j > 0 && rules[j].Priority > rules[j-1].Priority; j-- {
			rules[j], rules[j-1] = rules[j-1], rules[j]
		}
	}
}
