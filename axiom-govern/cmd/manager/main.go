// Command manager is the Management Harness management API server.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/laiw/management-harness/internal/api"
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

	server := api.NewServer(d.Config, d)
	zap.L().Info("starting manager", zap.Int("port", d.Config.Manager.Port))

	errCh := make(chan error, 1)
	go func() {
		if err := server.Start(); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		zap.L().Fatal("manager server error", zap.Error(err))
	case sig := <-waitForSignal():
		zap.L().Info("shutting down manager", zap.String("signal", sig.String()))
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}
}

func waitForSignal() <-chan os.Signal {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	return stop
}
