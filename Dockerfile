# Build frontend
FROM node:20-alpine AS webbuild
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Build backend (must satisfy go.mod `go 1.24.0`)
FROM golang:1.24-alpine AS gobuild
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY README.md LICENSE ./
COPY --from=webbuild /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/hearth ./cmd/hearth && \
    CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/reset-password ./cmd/reset-password

# Prepare default writable data dirs for the nonroot runtime.
# When a named volume is first attached to /data, Docker copies existing image
# contents into it (including permissions), so this avoids permission issues.
RUN mkdir -p /out/data/icons /out/data/cache \
	&& chmod -R 0777 /out/data

# CA certificates (needed for HTTPS background providers like Bing/Unsplash/Picsum).
FROM alpine:3.20 AS certs
RUN apk add --no-cache ca-certificates

# Runtime - use distroless base which includes glibc (required by modernc.org/sqlite's libc implementation)
FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /hearth
COPY --from=gobuild /out/hearth /hearth/hearth
COPY --from=gobuild /out/reset-password /hearth/reset-password
COPY --from=gobuild /src/web/dist /hearth/web/dist
COPY --from=gobuild /out/data /data
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
# Run as nonroot user (uid 65532) for security
USER nonroot
ENV HEARTH_ADDR=:8787
ENV HEARTH_DATA_DIR=/data
ENV HEARTH_DB_DSN=/data/hearth.db
EXPOSE 8787
VOLUME ["/data"]
ENTRYPOINT ["/hearth/hearth"]
