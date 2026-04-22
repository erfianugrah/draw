# AGENTS.md

## What this is

Self-hosted Excalidraw deployment. Four services (Caddy, Room, Storage, AI) running in Docker — either as separate containers (`docker-compose.yml`) or a single all-in-one image via s6-overlay (`docker-compose.standalone.yml`, `Dockerfile`).

No local dev server, no test suite, no linter. All verification is `docker compose up -d --build` and checking logs.

## Architecture

- **Caddy** — reverse proxy + static file server. Built with `xcaddy` (Cloudflare DNS plugin). Serves Excalidraw frontend from `/srv`.
- **Room** (:3002) — Socket.io collaboration. Cloned from upstream `excalidraw/excalidraw-room` at a pinned commit (not custom code).
- **Storage** (:3003) — Express.js + better-sqlite3. Drawings, rooms, files, exports tables. Auto-cleanup on timer.
- **AI** (:3004) — Express.js. OpenAI/Anthropic/Ollama provider switching. Persistent rate limits in JSON file.

All services are CommonJS (`require`), Node 18, plain Express. No TypeScript, no bundler.

## Two Caddyfiles

| File | Used by | Proxy targets |
|---|---|---|
| `Caddyfile` | `docker-compose.yml` (multi-container) | `excalidraw-room:3002`, `excalidraw-storage:3003`, `excalidraw-ai:3004` |
| `Caddyfile.embedded` | `Dockerfile` (all-in-one) | `localhost:3002`, `localhost:3003`, `localhost:3004` |

Both must stay in sync for security headers, routing rules, and CORS config.

## Patches

`patches/` contains **full file replacements** (not diffs) copied over upstream Excalidraw source during Docker build:

- `firebase.ts` → replaces Firebase with self-hosted storage API
- `ExportToExcalidrawPlus.tsx` → local share instead of Excalidraw+
- `index.html` → removes analytics and external CDN

Patches target a specific Excalidraw version (`EXCALIDRAW_VERSION` ARG in Dockerfiles, currently `v0.18.0`). The build **fails fast** if expected files don't exist in upstream — update patches when bumping `EXCALIDRAW_VERSION`.

## Build-time vs runtime config

`VITE_APP_*` variables are baked into the frontend at Docker build time, not configurable at runtime:

- Multi-container: set via `BASE_URL` in `.env` → docker-compose build args
- All-in-one image: CI passes empty strings → frontend uses relative paths (same-origin)

Changing the domain requires a rebuild of the caddy/frontend image.

## Deployment

Production runs on **Unraid via Composer** (self-hosted Docker Compose manager at `ghcr.io/erfianugrah/composer`). The stack uses `docker-compose.standalone.yml` — the pre-built all-in-one image `erfianugrah/excalidraw:latest` from Docker Hub.

- `.env` is SOPS-encrypted in the Composer-managed git stack. Composer decrypts on deploy, re-encrypts after.
- Deploys happen through Composer's UI/API or webhook — not by SSHing in and running `docker compose` directly.
- Image updates: push to `main` or tag `v*` → CI builds new image → Composer pulls `:latest` on next deploy.

## Commands

```bash
# Local dev / manual testing (not production)
# Multi-container (build from source)
docker compose up -d --build
docker compose logs -f

# All-in-one (pre-built image, same as production)
docker compose -f docker-compose.standalone.yml up -d

# Full rebuild (no cache)
docker compose build --no-cache && docker compose up -d

# Update Excalidraw version
# 1. Bump EXCALIDRAW_VERSION in Dockerfile and caddy/Dockerfile
# 2. Verify patches still apply (check upstream file structure)
# 3. docker compose build --no-cache
```

## CI

`.github/workflows/build-image.yml` — builds multi-arch (amd64/arm64) all-in-one image, pushes to `erfianugrah/excalidraw` on Docker Hub. Triggers on push to `main` or `v*` tags.

## Gotchas

- `better-sqlite3` is a native addon — storage builder stage needs `python3 make g++`
- `excalidraw-room` has no custom code in this repo — just a Dockerfile that clones upstream at a pinned commit
- Multi-container uses static IPs on `172.41.1.0/24` — relevant for Cloudflare Tunnel routing
- `.dockerignore` excludes `*.md` — this file won't end up in images
- `.env` has secrets (API tokens/keys) — only `.env.example` is committed
- No healthcheck endpoint on storage/AI — Caddy healthcheck hits its own admin API (`:2019/config/`)
