// Package models defines the core data structures used across the Management Harness.
package models

// ThreatType enumerates the categories of security threats detected.
type ThreatType string

const (
	ThreatPromptInjection  ThreatType = "prompt_injection"
	ThreatJailbreak        ThreatType = "jailbreak"
	ThreatPIIFound         ThreatType = "pii_found"
	ThreatToolEscalation   ThreatType = "tool_escalation"
	ThreatDataExfiltration ThreatType = "data_exfiltration"
	ThreatCommandInjection ThreatType = "command_injection"
)

// Severity enumerates threat severities.
type Severity string

const (
	SeverityLow      Severity = "low"
	SeverityMedium   Severity = "medium"
	SeverityHigh     Severity = "high"
	SeverityCritical Severity = "critical"
)

// Threat is a single detected security issue.
type Threat struct {
	Type     ThreatType `json:"type"`
	Severity Severity   `json:"severity"`
	Details  string     `json:"details"`
}

// SecurityScanResult is the outcome of scanning a request or response.
type SecurityScanResult struct {
	IsSafe           bool      `json:"is_safe"`
	Threats          []Threat  `json:"threats"`
	RedactedMessages []Message `json:"redacted_messages,omitempty"`
	RedactedPrompt   string    `json:"redacted_prompt,omitempty"`
	RedactedResponse string    `json:"redacted_response,omitempty"`
	Confidence       float64   `json:"confidence"`
}
