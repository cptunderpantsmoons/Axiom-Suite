# syntax=docker/dockerfile:1

# Multi-stage build for the Management Harness proxy/manager binaries.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/proxy ./cmd/proxy && \
    CGO_ENABLED=0 GOOS=linux go build -o /out/manager ./cmd/manager && \
    CGO_ENABLED=0 GOOS=linux go build -o /out/mcp ./cmd/mcp-proxy

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/proxy /app/proxy
COPY --from=build /out/manager /app/manager
COPY --from=build /out/mcp /app/mcp
COPY --from=build /src/configs /app/configs
COPY --from=build /src/internal/web/dist /app/internal/web/dist

EXPOSE 8080 8090 9091

# Default to the proxy; override with `docker run ... /app/manager` or
# `/app/mcp` to run the other binaries.
CMD ["/app/proxy"]
