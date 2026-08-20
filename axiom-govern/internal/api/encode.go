// Package api implements the Management Harness management REST API.
package api

import (
	"encoding/json"
	"io"
	"net/http"
)

func encodeJSON(w io.Writer, v interface{}) error {
	return json.NewEncoder(w).Encode(v)
}

func decodeJSONBody(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}
