package skills

import (
	"errors"
	"strings"

	"github.com/laiw/management-harness/internal/core/models"
)

var (
	// ErrNotFound is returned when a skill does not exist.
	ErrNotFound = errors.New("skill not found")
	// ErrForbidden is returned when the identity is not authorized to use a skill.
	ErrForbidden = errors.New("skill not authorized for this identity")
)

// Engine resolves and authorizes skills against the registry.
type Engine struct {
	reg *Registry
}

// NewEngine constructs an Engine over the given registry.
func NewEngine(reg *Registry) *Engine {
	return &Engine{reg: reg}
}

// Resolve returns the skill referenced by ref ("name" or "name@version",
// version is ignored in MVP single-version storage), or an error.
func (e *Engine) Resolve(ref string, identity *models.Identity) (*models.Skill, error) {
	name := ref
	if i := strings.IndexByte(ref, '@'); i >= 0 {
		name = ref[:i]
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, ErrNotFound
	}
	skill := e.reg.Snapshot()[name]
	if skill == nil {
		return nil, ErrNotFound
	}
	if !Authorize(skill, identity) {
		return nil, ErrForbidden
	}
	return skill, nil
}

// Get returns a skill by name without an authorization check.
func (e *Engine) Get(name string) *models.Skill {
	return e.reg.Snapshot()[name]
}

// Authorize reports whether an identity may use a skill.
func Authorize(skill *models.Skill, id *models.Identity) bool {
	if skill == nil {
		return false
	}
	if skill.Public {
		return true
	}
	if id == nil {
		return false
	}
	if id.IsAdmin {
		return true
	}
	if skill.Owner != "" && (id.TeamID == skill.Owner || id.OrgID == skill.Owner) {
		return true
	}
	for _, t := range skill.Teams {
		if t == id.TeamID {
			return true
		}
	}
	return false
}