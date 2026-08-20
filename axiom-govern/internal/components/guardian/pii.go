// Package guardian implements prompt-injection, jailbreak, and PII protection.
package guardian

import (
	"context"
	"regexp"

	"github.com/laiw/management-harness/internal/core/models"
)

// PIIFinding records a redacted PII occurrence.
type PIIFinding struct {
	Type  string `json:"type"`
	Count int    `json:"count"`
}

// piiPattern is a named PII detection pattern.
type piiPattern struct {
	name  string
	regex *regexp.Regexp
}

// PIIRedactor detects and redacts PII across messages and responses.
type PIIRedactor struct {
	patterns []piiPattern
}

// NewPIIRedactor constructs a redactor with a default set of PII patterns.
func NewPIIRedactor() *PIIRedactor {
	return &PIIRedactor{patterns: defaultPIIPatterns()}
}

func maskKeepEnd(s string) string {
	if len(s) <= 4 {
		return "****"
	}
	return s[:2] + "****" + s[len(s)-2:]
}

var (
	reEmail      = regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`)
	reSSN        = regexp.MustCompile(`\b\d{3}-\d{2}-\d{4}\b`)
	reCreditCard = regexp.MustCompile(`\b(?:\d[ -]*?){13,16}\b`)
	rePhone      = regexp.MustCompile(`(?:\+?\d{1,3}[\s.\-]?)?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}\b`)
	reIPv4       = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}\b`)
	reIPv6       = regexp.MustCompile(`\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b`)
	rePassport   = regexp.MustCompile(`\b[A-Z]{1,2}\d{6,9}\b`)
	reAusTFN     = regexp.MustCompile(`\b\d{3} \d{3} \d{3}\b`)
	reAusABN     = regexp.MustCompile(`\b\d{2} \d{3} \d{3} \d{3}\b`)
	reUKNINO     = regexp.MustCompile(`\b[A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}\d{6}[A-D]{1}\b`)
	reIBAN       = regexp.MustCompile(`\b[A-Z]{2}\d{2}[ ]?[A-Z0-9]{4}[ ]?[A-Z0-9]{4}[ ]?[A-Z0-9]{4}[ ]?[A-Z0-9]{2,}\b`)
	reETH        = regexp.MustCompile(`\b0x[a-fA-F0-9]{40}\b`)
	reBTC        = regexp.MustCompile(`\b(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,39}\b`)
	reAPIKey     = regexp.MustCompile(`\b(?:sk|pk|AKIA|AIza|ghp|hk)_[A-Za-z0-9_\-]{16,}\b`)
	reUSZip      = regexp.MustCompile(`\b\d{5}(?:-\d{4})?\b`)
	reDOB        = regexp.MustCompile(`\b(?:DOB|dob|birth ?date)[=:]*\d{4}-\d{2}-\d{2}\b`)
	reMAC        = regexp.MustCompile(`\b([0-9A-Fa-f]{2}(:|-)){5}[0-9A-Fa-f]{2}\b`)
	reSWIFT      = regexp.MustCompile(`\b[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?\b`)
)

func defaultPIIPatterns() []piiPattern {
	return []piiPattern{
		{name: "email", regex: reEmail},
		{name: "ssn", regex: reSSN},
		{name: "credit_card", regex: reCreditCard},
		{name: "phone", regex: rePhone},
		{name: "ipv4", regex: reIPv4},
		{name: "ipv6", regex: reIPv6},
		{name: "passport", regex: rePassport},
		{name: "australian_tfn", regex: reAusTFN},
		{name: "australian_abn", regex: reAusABN},
		{name: "uk_nino", regex: reUKNINO},
		{name: "iban", regex: reIBAN},
		{name: "eth_address", regex: reETH},
		{name: "btc_address", regex: reBTC},
		{name: "api_key", regex: reAPIKey},
		{name: "us_zip", regex: reUSZip},
		{name: "date_of_birth", regex: reDOB},
		{name: "mac_address", regex: reMAC},
		{name: "swift", regex: reSWIFT},
	}
}

// Redact returns PII-redacted copies of the messages and the findings summary.
func (r *PIIRedactor) Redact(ctx context.Context, messages []models.Message) ([]models.Message, []PIIFinding) {
	out := make([]models.Message, len(messages))
	findingsMap := map[string]int{}
	for i, m := range messages {
		content := m.Content
		for _, p := range r.patterns {
			matches := p.regex.FindAllString(content, -1)
			if len(matches) > 0 {
				findingsMap[p.name] += len(matches)
				content = p.regex.ReplaceAllStringFunc(content, maskKeepEnd)
			}
		}
		out[i] = models.Message{Role: m.Role, Content: content}
	}
	return out, summarize(findingsMap)
}

// RedactResponse redacts PII from a response string.
func (r *PIIRedactor) RedactResponse(ctx context.Context, response string) (string, []PIIFinding) {
	findingsMap := map[string]int{}
	out := response
	for _, p := range r.patterns {
		matches := p.regex.FindAllString(out, -1)
		if len(matches) > 0 {
			findingsMap[p.name] += len(matches)
			out = p.regex.ReplaceAllStringFunc(out, maskKeepEnd)
		}
	}
	return out, summarize(findingsMap)
}

func summarize(m map[string]int) []PIIFinding {
	out := make([]PIIFinding, 0, len(m))
	for k, v := range m {
		out = append(out, PIIFinding{Type: k, Count: v})
	}
	return out
}
