# Management Harness — Makefile

GO ?= go
BINARY_DIR := bin
PROXY_BIN := $(BINARY_DIR)/management-harness-proxy
MANAGER_BIN := $(BINARY_DIR)/management-harness-manager
MCP_BIN := $(BINARY_DIR)/management-harness-mcp

.PHONY: all build proxy manager mcp test vet fmt tidy clean run-proxy run-manager docker-up docker-down

all: build

build: proxy manager mcp

proxy:
	$(GO) build -o $(PROXY_BIN) ./cmd/proxy

manager:
	$(GO) build -o $(MANAGER_BIN) ./cmd/manager

mcp:
	$(GO) build -o $(MCP_BIN) ./cmd/mcp-proxy

test:
	$(GO) test ./... -race -count=1

vet:
	$(GO) vet ./...

fmt:
	$(GO) fmt ./...

tidy:
	$(GO) mod tidy

run-proxy: proxy
	MH_CONFIG_FILE=./configs/config.yaml $(PROXY_BIN)

run-manager: manager
	MH_CONFIG_FILE=./configs/config.yaml $(MANAGER_BIN)

docker-up:
	docker compose -f docker-compose.yml up -d

docker-down:
	docker compose -f docker-compose.yml down

clean:
	rm -rf $(BINARY_DIR)
