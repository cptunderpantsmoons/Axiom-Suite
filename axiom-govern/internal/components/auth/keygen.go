// Package auth implements API key authentication for the Management Harness.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
)

const keyPrefix = "hk_"

var keyFormat = regexp.MustCompile(`^hk_[A-Za-z0-9]{32,}$`)

// GenerateAPIKey generates a new `hk_`-prefixed API key.
func GenerateAPIKey() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("failed to generate key material: %w", err)
	}
	body := hex.EncodeToString(buf) // 48 hex chars
	return keyPrefix + body, nil
}

// HashAPIKey returns the SHA-256 hex hash of a raw API key.
func HashAPIKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// PrefixOf returns the first 8 characters of a key for display.
func PrefixOf(key string) string {
	if len(key) < 8 {
		return key
	}
	return key[:8]
}

// ValidateAPIKeyFormat checks whether a key matches the expected format.
func ValidateAPIKeyFormat(key string) bool {
	return keyFormat.MatchString(key)
}

// TokenFromHeader extracts a bearer token from an HTTP Authorization header value.
func TokenFromHeader(header string) (string, bool) {
	if header == "" {
		return "", false
	}
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer "), true
	}
	if strings.HasPrefix(header, "Basic ") {
		// Allow Basic auth where the username is the key and password is empty.
		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 {
			return "", false
		}
		decoded := decodeBasic(parts[1])
		if i := strings.Index(decoded, ":"); i >= 0 {
			return decoded[:i], true
		}
		return decoded, true
	}
	return header, true
}

func decodeBasic(encoded string) string {
	if b, err := base64.StdEncoding.DecodeString(encoded); err == nil {
		return string(b)
	}
	return encoded
}
