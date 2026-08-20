// Package web provides the embedded management dashboard assets.
package web

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed dist
var distFS embed.FS

// Handler returns an http.Handler serving the embedded dashboard.
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err)
	}
	return http.FileServer(http.FS(sub))
}

// DistFS exposes the embedded filesystem for advanced use.
func DistFS() fs.FS {
	sub, _ := fs.Sub(distFS, "dist")
	return sub
}
