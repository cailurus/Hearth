.PHONY: dev dev-backend dev-web clean build web-build go-build docker docker-compose-up docker-compose-down

# Basic targets:
# - make dev    : run backend + frontend dev servers together
# - make clean  : remove local data dir (reset all persisted config)
# - make build  : build frontend + backend (host build)
# - make docker : build Docker image
# - make docker-compose-up : run via docker compose

# You can override these when needed:
#   make clean HEARTH_DATA_DIR=/path/to/data
#   make dev   HEARTH_ADDR=:8787

HEARTH_ADDR ?= :8787

dev:
	@set -e; \
	ADDR="$${HEARTH_ADDR:-$(HEARTH_ADDR)}"; \
	echo "Starting Hearth dev (backend + web)..."; \
	echo "- Installing frontend deps if needed..."; \
	(cd web && npm ci --prefer-offline --silent 2>/dev/null || npm ci); \
	echo "- Backend: http://0.0.0.0$$ADDR"; \
	echo "- Web dev:  http://0.0.0.0:5173"; \
	echo "  (Access from phone using your local IP)"; \
	(cd web && npm run dev -- --host 0.0.0.0) & WEB_PID=$$!; \
	trap 'kill $$WEB_PID 2>/dev/null || true' INT TERM EXIT; \
	HEARTH_ADDR="0.0.0.0$$ADDR" go run ./cmd/hearth

clean:
	@set -e; \
	DATA_DIR="$${HEARTH_DATA_DIR:-data}"; \
	if [ -z "$$DATA_DIR" ] || [ "$$DATA_DIR" = "/" ]; then \
		echo "Refusing to remove DATA_DIR='$$DATA_DIR'"; \
		exit 1; \
	fi; \
	echo "Cleaning Hearth workspace..."; \
	echo "- Removing data dir: $$DATA_DIR"; \
	rm -rf "$$DATA_DIR"; \
	echo "- Removing backend build outputs: dist/"; \
	rm -rf dist; \
	echo "- Removing frontend build/cache: web/dist web/.vite"; \
	rm -rf web/dist web/.vite; \
	echo "- Removing frontend deps: web/node_modules"; \
	rm -rf web/node_modules; \
	echo "Done."

build: web-build go-build

web-build:
	@set -e; \
	cd web; \
	npm ci; \
	npm run build

go-build:
	@set -e; \
	mkdir -p dist; \
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o dist/hearth ./cmd/hearth; \
	echo "Built: dist/hearth"; \
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o dist/reset-password ./cmd/reset-password; \
	echo "Built: dist/reset-password"

docker:
	docker build -t hearth:local .

docker-compose-up:
	docker compose up --build

docker-compose-down:
	docker compose down
