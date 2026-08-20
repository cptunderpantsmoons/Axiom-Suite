// Package auth implements API key authentication for the Management Harness.
package auth

import "errors"

// ErrKeyNotFound is returned when an API key does not exist.
var ErrKeyNotFound = errors.New("auth: api key not found")

// ErrKeyRevoked is returned when an API key has been revoked.
var ErrKeyRevoked = errors.New("auth: api key revoked")

// ErrKeyExpired is returned when an API key has expired.
var ErrKeyExpired = errors.New("auth: api key expired")
