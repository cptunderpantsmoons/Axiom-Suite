package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/laiw/management-harness/internal/core/models"
)

type axiomContextKey struct{}

func attachAxiomEnvelope(r *http.Request, envelope *models.AxiomRequestEnvelope) {
	if envelope == nil {
		return
	}
	*r = *r.WithContext(context.WithValue(r.Context(), axiomContextKey{}, envelope))
}

func axiomEnvelopeFromRequest(r *http.Request) *models.AxiomRequestEnvelope {
	if r == nil {
		return nil
	}
	envelope, _ := r.Context().Value(axiomContextKey{}).(*models.AxiomRequestEnvelope)
	return envelope
}

func validateAxiomRequest(req *models.ChatRequest) error {
	if req == nil || req.Axiom == nil {
		return nil
	}
	return models.ValidateAxiomEnvelope(req.Axiom)
}

func axiomAuditDetails(r *http.Request) json.RawMessage {
	envelope := axiomEnvelopeFromRequest(r)
	if envelope == nil {
		return nil
	}
	// Deliberately record references and decisions, never the packet body.
	value := map[string]any{
		"schema_version": "govern.audit-details.v1",
		"axiom": map[string]any{
			"stage": "task.execute",
			"taskpacket_id": envelope.TaskPacketID,
			"intent_id": envelope.Compile.IntentID,
			"packet_hash": envelope.PacketHash,
			"compile_schema_version": envelope.Compile.ContractVersion,
			"risk_score": envelope.Compile.RiskScore,
			"dangerous": envelope.Compile.Dangerous,
		},
	}
	if envelope.Ground != nil {
		value["ground"] = map[string]any{
			"project_id": envelope.Ground.ProjectID,
			"snapshot_hash": envelope.Ground.SnapshotHash,
			"prompt_pack_id": envelope.Ground.PromptPackID,
			"drift_score": envelope.Ground.DriftScore,
			"code_index_hash": envelope.Ground.CodeIndexHash,
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage(fmt.Sprintf(`{"schema_version":"govern.audit-details.v1","error":%q}`, err.Error()))
	}
	return encoded
}
