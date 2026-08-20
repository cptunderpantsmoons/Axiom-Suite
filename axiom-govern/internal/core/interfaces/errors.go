// Package interfaces defines the component contracts used across the Management Harness.
package interfaces

import "errors"

// ErrCacheMiss is returned when a cache lookup does not find a value.
var ErrCacheMiss = errors.New("cache: miss")

// ErrProviderUnavailable is returned when a provider cannot service a request.
var ErrProviderUnavailable = errors.New("provider: unavailable")
