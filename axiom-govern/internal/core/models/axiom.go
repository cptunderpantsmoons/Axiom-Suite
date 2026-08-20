package models

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// AxiomGroundRefs links a governed request to the exact Ground state used by
// Compile. These are references only; Govern does not trust them as policy.
type AxiomGroundRefs struct {
	ProjectID          string  `json:"project_id"`
	SnapshotHash       string  `json:"snapshot_hash"`
	PromptPackID       *string `json:"prompt_pack_id"`
	DriftScore         *float64 `json:"drift_score"`
	CodeIndexHash      *string `json:"code_index_hash"`
}

// AxiomCompileRefs contains the Compile identity and advisory risk result.
type AxiomCompileRefs struct {
	ContractVersion int     `json:"contract_version"`
	IntentID        string  `json:"intent_id"`
	Mode            string  `json:"mode"`
	RiskScore       float64 `json:"risk_score"`
	Dangerous       string  `json:"dangerous"`
}

// AxiomRequestEnvelope is gateway-local metadata. It must be removed before
// an upstream provider request is made.
type AxiomRequestEnvelope struct {
	SchemaVersion string             `json:"schema_version"`
	TaskPacketID  string             `json:"taskpacket_id"`
	PacketHash    string             `json:"packet_hash"`
	Compile       AxiomCompileRefs   `json:"compile"`
	Ground        *AxiomGroundRefs   `json:"ground"`
	TaskPacket    json.RawMessage    `json:"task_packet"`
}

var axiomPacketHash = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

// ValidateAxiomEnvelope validates the envelope and verifies the packet digest.
// encoding/json sorts object keys when marshaling maps, matching the canonical
// JSON representation emitted by the TypeScript integration adapter.
func ValidateAxiomEnvelope(envelope *AxiomRequestEnvelope) error {
	if envelope == nil {
		return nil
	}
	if envelope.SchemaVersion != "axiom.taskpacket.v1" {
		return fmt.Errorf("unsupported Axiom schema version %q", envelope.SchemaVersion)
	}
	if strings.TrimSpace(envelope.TaskPacketID) == "" || strings.TrimSpace(envelope.Compile.IntentID) == "" {
		return fmt.Errorf("Axiom taskpacket_id and compile.intent_id are required")
	}
	if envelope.Compile.ContractVersion != 1 {
		return fmt.Errorf("unsupported Compile contract version %d", envelope.Compile.ContractVersion)
	}
	if envelope.ModeInvalid() {
		return fmt.Errorf("invalid Compile mode %q", envelope.Compile.Mode)
	}
	if envelope.DangerousInvalid() {
		return fmt.Errorf("invalid Compile dangerous value %q", envelope.Compile.Dangerous)
	}
	if envelope.Compile.RiskScore < 0 || envelope.Compile.RiskScore > 1 {
		return fmt.Errorf("Compile risk score must be between 0 and 1")
	}
	if !axiomPacketHash.MatchString(envelope.PacketHash) {
		return fmt.Errorf("invalid Axiom packet hash")
	}
	if len(envelope.TaskPacket) == 0 || string(envelope.TaskPacket) == "null" {
		return fmt.Errorf("Axiom task_packet is required")
	}

	var packet struct {
		ContractV     int    `json:"contract_v"`
		PacketID      string `json:"packet_id"`
		IntentID      string `json:"intent_id"`
	}
	if err := json.Unmarshal(envelope.TaskPacket, &packet); err != nil {
		return fmt.Errorf("invalid Axiom task_packet: %w", err)
	}
	if packet.ContractV != 1 {
		return fmt.Errorf("unsupported task_packet contract version %d", packet.ContractV)
	}
	if packet.PacketID != envelope.TaskPacketID {
		return fmt.Errorf("taskpacket_id does not match task_packet.packet_id")
	}
	if packet.IntentID != envelope.Compile.IntentID {
		return fmt.Errorf("compile.intent_id does not match task_packet.intent_id")
	}

	var normalized any
	if err := json.Unmarshal(envelope.TaskPacket, &normalized); err != nil {
		return fmt.Errorf("invalid Axiom task_packet JSON: %w", err)
	}
	canonical, err := json.Marshal(normalized)
	if err != nil {
		return fmt.Errorf("canonicalize Axiom task_packet: %w", err)
	}
	digest := sha256.Sum256(canonical)
	actual := "sha256:" + hex.EncodeToString(digest[:])
	if actual != envelope.PacketHash {
		return fmt.Errorf("Axiom packet hash mismatch")
	}
	if envelope.Ground != nil && strings.TrimSpace(envelope.Ground.SnapshotHash) == "" {
		return fmt.Errorf("Axiom Ground snapshot_hash is required when ground is present")
	}
	return nil
}

func (e *AxiomRequestEnvelope) ModeInvalid() bool {
	return e.Compile.Mode != "auto" && e.Compile.Mode != "interactive" && e.Compile.Mode != "one-shot"
}

func (e *AxiomRequestEnvelope) DangerousInvalid() bool {
	return e.Compile.Dangerous != "none" && e.Compile.Dangerous != "destructive" && e.Compile.Dangerous != "require_plan"
}
