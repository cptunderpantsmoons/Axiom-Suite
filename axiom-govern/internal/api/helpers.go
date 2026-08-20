// Package api implements the Management Harness management REST API.
package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// chiID extracts a URL path parameter by name.
func chiID(r *http.Request, name string) string {
	return chi.URLParam(r, name)
}
