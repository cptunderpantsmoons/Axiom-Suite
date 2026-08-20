// Package guardian implements prompt-injection, jailbreak, and PII protection.
package guardian

import (
	"context"
	"regexp"
	"strings"

	"github.com/laiw/management-harness/internal/core/models"
)

// InjectionResult is the outcome of injection detection.
type InjectionResult struct {
	Detected bool
	Matches  []string
}

// JailbreakResult is the outcome of jailbreak detection.
type JailbreakResult struct {
	Detected bool
	Matches  []string
}

// EscalationResult is the outcome of tool-escalation detection.
type EscalationResult struct {
	Detected bool
	Matches  []string
}

var (
	injectionPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)ignore (all|previous|prior|above) (instructions|prompts|rules|system messages)`),
		regexp.MustCompile(`(?i)disregard (your|the) (previous|system|above)`),
		regexp.MustCompile(`(?i)you are (now )?(a|an) (new|different|unfiltered|uncensored|jailbroken)`),
		regexp.MustCompile(`(?i)system prompt:`),
		regexp.MustCompile(`(?i)developer mode`),
		regexp.MustCompile(`(?i)reveal (your|the) (system|hidden|initial) (prompt|instructions)`),
		regexp.MustCompile(`(?i)DAN\s*[:\-]?`),
		regexp.MustCompile(`(?i)act as (if you were|though you are)`),
	}

	jailbreakPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(bypass|circumvent|override) (the |your |all )?(safety|security|content|ethical) ?(and )?(filters|guidelines|restrictions|measures)`),
		regexp.MustCompile(`(?i)(no|without) (moral|ethical) (restrictions|guidelines|filters)`),
		regexp.MustCompile(`(?i)pretend (to be|you are) (an |a )?(ai|assistant) (with|without)`),
		regexp.MustCompile(`(?i)rules? (no longer|don't|do not) apply`),
	}

	escalationPatterns = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(run|execute|invoke|call) (the )?(shell|bash|cmd|terminal|system) command`),
		regexp.MustCompile(`(?i)(delete|rm|drop|truncate) (all|every|the) (files|records|database|table)`),
		regexp.MustCompile(`(?i)(exfiltrate|send|upload) (data|keys?|secrets?) to (an |a )?external`),
		regexp.MustCompile(`(?i)disable (the )?(firewall|security|guardian|monitoring)`),
	}
)

// DetectInjection scans messages for prompt-injection patterns.
func DetectInjection(ctx context.Context, messages []models.Message) (*InjectionResult, bool) {
	res := &InjectionResult{}
	for _, m := range messages {
		for _, re := range injectionPatterns {
			if matches := re.FindAllString(m.Content, -1); len(matches) > 0 {
				res.Detected = true
				res.Matches = append(res.Matches, matches...)
			}
		}
	}
	return res, res.Detected
}

// DetectJailbreak scans messages for jailbreak patterns.
func DetectJailbreak(ctx context.Context, messages []models.Message) (*JailbreakResult, bool) {
	res := &JailbreakResult{}
	for _, m := range messages {
		for _, re := range jailbreakPatterns {
			if matches := re.FindAllString(m.Content, -1); len(matches) > 0 {
				res.Detected = true
				res.Matches = append(res.Matches, matches...)
			}
		}
	}
	return res, res.Detected
}

// DetectToolEscalation scans a request for tool-escalation attempts.
func DetectToolEscalation(ctx context.Context, req *models.ChatRequest) (*EscalationResult, bool) {
	res := &EscalationResult{}
	for _, m := range req.Messages {
		for _, re := range escalationPatterns {
			if matches := re.FindAllString(m.Content, -1); len(matches) > 0 {
				res.Detected = true
				res.Matches = append(res.Matches, matches...)
			}
		}
	}
	return res, res.Detected
}

// InjectionDetector detects prompt injection.
type InjectionDetector interface {
	Detect(ctx context.Context, messages []models.Message) (*InjectionResult, bool)
}

// JailbreakDetector detects jailbreak attempts.
type JailbreakDetector interface {
	Detect(ctx context.Context, messages []models.Message) (*JailbreakResult, bool)
}

// DefaultInjectionDetector uses built-in patterns.
type DefaultInjectionDetector struct{}

// Detect implements InjectionDetector.
func (DefaultInjectionDetector) Detect(ctx context.Context, messages []models.Message) (*InjectionResult, bool) {
	return DetectInjection(ctx, messages)
}

// DefaultJailbreakDetector uses built-in patterns.
type DefaultJailbreakDetector struct{}

// Detect implements JailbreakDetector.
func (DefaultJailbreakDetector) Detect(ctx context.Context, messages []models.Message) (*JailbreakResult, bool) {
	return DetectJailbreak(ctx, messages)
}

// redactQuoted redacts any text flagged by a detector helper.
func redactQuoted(s string, re *regexp.Regexp) string {
	return re.ReplaceAllStringFunc(s, func(m string) string {
		return strings.Repeat("*", len(m))
	})
}
