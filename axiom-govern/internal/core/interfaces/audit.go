// Package interfaces defines the component contracts used across the Management Harness.
package interfaces

import (
	"context"

	"github.com/laiw/management-harness/internal/core/models"
)

// AuditLogger records immutable audit events.
type AuditLogger interface {
	Log(ctx context.Context, event *models.AuditEvent) error
	Flush(ctx context.Context) error
}
