// Package audit implements the immutable, hash-chained audit log.
package audit

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/laiw/management-harness/internal/core/models"
)

// ComputeHash computes the SHA-256 hash of an audit event. The event's own
// Hash and PreviousHash fields are excluded from the input to keep chaining stable.
func ComputeHash(event *models.AuditEvent) string {
	// Build a canonical, ordered representation of the event.
	pairs := []string{
		"id=" + event.ID,
		"timestamp=" + event.Timestamp.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
		"previous_hash=" + event.PreviousHash,
		"user_id=" + event.UserID,
		"team_id=" + event.TeamID,
		"api_key_id=" + event.APIKeyID,
		"request_id=" + event.RequestID,
		"action=" + event.Action,
		"resource=" + event.Resource,
		"outcome=" + event.Outcome,
		"details=" + string(event.Details),
		"ip_address=" + event.IPAddress,
		"user_agent=" + event.UserAgent,
	}

	// Include the choices' contents deterministically.
	content := strings.Join(pairs, "|")

	h := sha256.Sum256([]byte(content))
	return hex.EncodeToString(h[:])
}

// VerifyHash verifies that an event's stored hash matches a recomputed hash.
func VerifyHash(event *models.AuditEvent) bool {
	return ComputeHash(event) == event.Hash
}

// HashChain maintains the previous hash for sequential event hashing.
type HashChain struct {
	previous string
}

// NewHashChain creates a hash chain seeded with a genesis value.
func NewHashChain(genesis string) *HashChain {
	return &HashChain{previous: genesis}
}

// Next computes and stamps the hash for the given event, updating the chain.
func (c *HashChain) Next(event *models.AuditEvent) {
	event.PreviousHash = c.previous
	event.Hash = ComputeHash(event)
	c.previous = event.Hash
}

// Current returns the latest hash in the chain.
func (c *HashChain) Current() string {
	return c.previous
}

// verifyChainIntegrity checks a sequence of events for tampering.
func verifyChainIntegrity(events []*models.AuditEvent, genesis string) (bool, int) {
	prev := genesis
	for i, e := range events {
		if e.PreviousHash != prev {
			return false, i
		}
		if !VerifyHash(e) {
			return false, i
		}
		prev = e.Hash
	}
	return true, -1
}

// canonicalJSON marshals v to a stable, sorted JSON string (for debugging/export).
func canonicalJSON(v interface{}) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	var m map[string]interface{}
	if err := json.Unmarshal(b, &m); err != nil {
		return string(b), nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		kv, _ := json.Marshal(m[k])
		parts = append(parts, fmt.Sprintf("%q:%s", k, string(kv)))
	}
	return "{" + strings.Join(parts, ",") + "}", nil
}
