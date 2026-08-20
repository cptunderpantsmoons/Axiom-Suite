package skills

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/laiw/management-harness/internal/core/models"
)

var (
	// ErrUnknownSlot is returned when a template references an undeclared slot.
	ErrUnknownSlot = errors.New("template references an undeclared slot")
	// ErrMissingParam is returned when a required parameter is absent.
	ErrMissingParam = errors.New("missing required parameter")
	// ErrInvalidParam is returned when a parameter fails validation.
	ErrInvalidParam = errors.New("invalid parameter value")
)

var slotRe = regexp.MustCompile(`\{\{\s*([A-Za-z0-9_]+)\s*\}\}`)

// Expand validates and interpolates a skill template with the supplied params,
// returning the assembled messages (system prompt + filled user message). The
// interpolator is deliberately strict (declared slots only, no expressions) so
// client-controlled parameter values cannot inject template directives.
func Expand(skill *models.Skill, params map[string]any) ([]models.Message, error) {
	if skill == nil {
		return nil, errors.New("nil skill")
	}
	declared := map[string]*models.SkillParam{}
	for i := range skill.Parameters {
		declared[skill.Parameters[i].Name] = &skill.Parameters[i]
	}

	// Every slot in the template must be a declared parameter.
	for _, m := range slotRe.FindAllStringSubmatch(skill.Template, -1) {
		if _, ok := declared[m[1]]; !ok {
			return nil, fmt.Errorf("%w: %s", ErrUnknownSlot, m[1])
		}
	}

	// Resolve each declared parameter to a concrete value.
	values := map[string]any{}
	for name, p := range declared {
		v, present := params[name]
		if !present {
			if p.Default != nil {
				v = p.Default
			} else if p.Required {
				return nil, fmt.Errorf("%w: %s", ErrMissingParam, name)
			} else {
				v = ""
			}
		}
		if err := validateParam(p, v); err != nil {
			return nil, fmt.Errorf("parameter %q: %w", name, err)
		}
		values[name] = v
	}

	filled := slotRe.ReplaceAllStringFunc(skill.Template, func(m string) string {
		name := slotRe.FindStringSubmatch(m)[1]
		return stringify(values[name])
	})

	messages := make([]models.Message, 0, 2)
	if strings.TrimSpace(skill.SystemPrompt) != "" {
		messages = append(messages, models.Message{Role: "system", Content: skill.SystemPrompt})
	}
	messages = append(messages, models.Message{Role: "user", Content: filled})
	return messages, nil
}

func validateParam(p *models.SkillParam, v any) error {
	if len(p.Enum) > 0 {
		vs := stringify(v)
		for _, e := range p.Enum {
			if stringify(e) == vs {
				goto length
			}
		}
		return fmt.Errorf("%w: value %q not in enum", ErrInvalidParam, vs)
	}
length:
	if p.MaxLength > 0 && len(stringify(v)) > p.MaxLength {
		return fmt.Errorf("%w: exceeds max length %d", ErrInvalidParam, p.MaxLength)
	}
	return nil
}

func stringify(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		return fmt.Sprintf("%v", t)
	default:
		return fmt.Sprintf("%v", v)
	}
}