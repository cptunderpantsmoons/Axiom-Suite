// Package guardian implements prompt-injection, jailbreak, and PII protection.
package guardian

import (
	"context"
	"encoding/json"
	"io"
	"strings"

	"github.com/laiw/management-harness/internal/core/models"
)

type redactedReqKeyT struct{}

var redactedReqKey = redactedReqKeyT{}

// RedactedRequestFrom retrieves the guardian-redacted request from context.
func RedactedRequestFrom(ctx context.Context) (*models.ChatRequest, bool) {
	v := ctx.Value(redactedReqKey)
	if v == nil {
		return nil, false
	}
	req, ok := v.(*models.ChatRequest)
	return req, ok
}

func decodeJSON(r io.Reader, v interface{}) error {
	dec := json.NewDecoder(r)
	return dec.Decode(v)
}

func joinMatches(matches []string) string {
	if len(matches) == 0 {
		return ""
	}
	return "matched: " + strings.Join(matches, "; ")
}

func joinContents(messages []models.Message) string {
	parts := make([]string, 0, len(messages))
	for _, m := range messages {
		parts = append(parts, m.Role+": "+m.Content)
	}
	return strings.Join(parts, "\n")
}

func threatsJSON(threats []models.Threat) string {
	b, err := json.Marshal(threats)
	if err != nil {
		return "[]"
	}
	return string(b)
}
