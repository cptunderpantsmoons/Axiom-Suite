package models

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func testPacket() []byte {
	packet := map[string]any{
		"contract_v": 1,
		"packet_id": "11111111-1111-4111-8111-111111111111",
		"intent_id": "22222222-2222-4222-8222-222222222222",
		"task_contract": map[string]any{"objective": "test", "task_type": "test"},
	}
	b, _ := json.Marshal(packet)
	return b
}

func testEnvelope() *AxiomRequestEnvelope {
	packet := testPacket()
	var normalized any
	_ = json.Unmarshal(packet, &normalized)
	canonical, _ := json.Marshal(normalized)
	digest := sha256.Sum256(canonical)
	return &AxiomRequestEnvelope{
		SchemaVersion: "axiom.taskpacket.v1",
		TaskPacketID:  "11111111-1111-4111-8111-111111111111",
		PacketHash:    "sha256:" + hex.EncodeToString(digest[:]),
		Compile: AxiomCompileRefs{
			ContractVersion: 1,
			IntentID:        "22222222-2222-4222-8222-222222222222",
			Mode:            "one-shot",
			RiskScore:       0.2,
			Dangerous:       "none",
		},
		Ground: &AxiomGroundRefs{ProjectID: "ctxproj_fixture", SnapshotHash: "ctxsnap_fixture"},
		TaskPacket: packet,
	}
}

func TestValidateAxiomEnvelope(t *testing.T) {
	if err := ValidateAxiomEnvelope(testEnvelope()); err != nil {
		t.Fatalf("valid envelope rejected: %v", err)
	}
}

func TestValidateAxiomEnvelopeRejectsHashMismatch(t *testing.T) {
	env := testEnvelope()
	env.PacketHash = "sha256:" + hex.EncodeToString(make([]byte, 32))
	if err := ValidateAxiomEnvelope(env); err == nil {
		t.Fatal("expected packet hash mismatch")
	}
}

func TestValidateAxiomEnvelopeRejectsIdentityMismatch(t *testing.T) {
	env := testEnvelope()
	env.TaskPacketID = "33333333-3333-4333-8333-333333333333"
	if err := ValidateAxiomEnvelope(env); err == nil {
		t.Fatal("expected taskpacket identity mismatch")
	}
}
