// Command mcp-proxy is the Management Harness MCP stdio proxy.
package main

import (
	"fmt"
	"os"

	"github.com/laiw/management-harness/internal/adapters/mcp"
	"github.com/laiw/management-harness/internal/bootstrap"
)

func main() {
	configFile := os.Getenv("MH_CONFIG_FILE")
	d, err := bootstrap.Build(configFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to bootstrap: %v\n", err)
		os.Exit(1)
	}
	defer bootstrap.Shutdown(d)

	proxy := mcp.NewMCPProxy(d)
	if err := proxy.ServeStdio(); err != nil {
		fmt.Fprintf(os.Stderr, "mcp proxy error: %v\n", err)
		os.Exit(1)
	}
}
