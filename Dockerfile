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
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/hearth ./cmd/hearth

# Prepare default writable data dirs for the nonroot runtime.
# When a named volume is first attached to /data, Docker copies existing image
# contents into it (including permissions), so this avoids permission issues.
RUN mkdir -p /out/data/icons /out/data/cache \
	&& chmod -R 0777 /out/data

# Runtime
FROM gcr.io/distroless/base-debian12:nonroot
WORKDIR /app
COPY --from=gobuild /out/hearth /app/hearth
COPY --from=gobuild /src/web/dist /app/web/dist
COPY --from=gobuild /out/data /data
ENV HEARTH_ADDR=:8787
ENV HEARTH_DATA_DIR=/data
ENV HEARTH_DB_DSN=/data/hearth.db
EXPOSE 8787
VOLUME ["/data"]
ENTRYPOINT ["/app/hearth"]
