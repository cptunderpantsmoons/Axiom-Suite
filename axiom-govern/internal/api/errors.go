// Package api implements the Management Harness management REST API.
package api

import "errors"

// ErrNotFound is returned when a resource does not exist.
var ErrNotFound = errors.New("api: not found")
