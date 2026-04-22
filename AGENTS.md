# AGENTS.md

## What this is

Self-hosted Excalidraw deployment. Four services (Frontend, Room, Storage, AI) built from source in Docker. External Caddy on the host handles TLS and reverse proxying.

No local dev server, no test suite, no linter. All verification is `docker compose up -d --build` and checking logs.

## Architecture

- **Frontend** (:3001) — Excalidraw SPA served by busybox httpd. Built from upstream source with patches applied. Auto-detects latest Excalidraw release at build time.
- **Room** (:3002) — Socket.io collaboration. Cloned from upstream `excalidraw/excalidraw-room` at a pinned commit (not custom code).
- **Storage** (:3003) — Express.js + better-sqlite3. Drawings, rooms, files, exports tables. Auto-cleanup on timer.
- **AI** (:3004) — Express.js. OpenAI/Anthropic/Ollama provider switching. Persistent rate limits in JSON file.

All backend services are CommonJS (`require`), Node 18, plain Express. No TypeScript, no bundler. The frontend is static files only — no built-in reverse proxy or TLS.

External Caddy (Unraid host, `network_mode: host`) proxies to `localhost:3001-3004`.

## Patches

`patches/` contains **full file replacements** (not diffs) copied over upstream Excalidraw source during Docker build:

- `firebase.ts` → replaces Firebase with self-hosted storage API
- `ExportToExcalidrawPlus.tsx` → local share instead of Excalidraw+
- `index.html` → removes analytics and external CDN

`EXCALIDRAW_VERSION` defaults to empty in `frontend/Dockerfile` — auto-resolves to the latest upstream release tag via `git ls-remote`. Pin to a specific tag if patches break. Build **fails fast** if expected files don't exist in upstream.

## Build-time config

`VITE_APP_*` variables are baked into the frontend at Docker build time, not configurable at runtime. `frontend/Dockerfile` defaults them to empty strings → frontend uses relative paths (same-origin). External reverse proxy handles all routing.

## Deployment

Production runs on **Unraid via Composer** (`ghcr.io/erfianugrah/composer`). Stack name: `draw`. Composer clones this repo and runs `docker compose up -d --build`.

- `.env` is SOPS-encrypted in the git repo. Composer decrypts on deploy, re-encrypts after.
- Deploys via Composer UI/API/webhook — not by SSHing in.
- GitHub webhook triggers auto-redeploy on push to `main`.

### Composer API (from dev machine)

```bash
# Sync (git pull)
curl -X POST -H "X-API-Key: $COMPOSER_API_KEY" \
  https://composer.erfi.io/api/v1/stacks/draw/sync

# Build and deploy (async — returns job_id)
curl -X POST -H "X-API-Key: $COMPOSER_API_KEY" \
  "https://composer.erfi.io/api/v1/stacks/draw/build?async=true"

# Check job status
curl -H "X-API-Key: $COMPOSER_API_KEY" \
  https://composer.erfi.io/api/v1/jobs/{job_id}

# Full deploy (sync + pull + up, for git stacks)
curl -X POST -H "X-API-Key: $COMPOSER_API_KEY" \
  "https://composer.erfi.io/api/v1/stacks/draw/deploy?async=true"
```

## Commands

```bash
# Local build + start (same as Composer runs)
docker compose up -d --build
docker compose logs -f

# Full rebuild (no cache)
docker compose build --no-cache && docker compose up -d

# Rebuild with a pinned Excalidraw version (if latest breaks patches)
docker compose build --build-arg EXCALIDRAW_VERSION=v0.18.0 --no-cache
```

## CI

`.github/workflows/build-image.yml` — builds multi-arch (amd64/arm64) all-in-one image, pushes to `erfianugrah/excalidraw` on Docker Hub. Triggers on push to `main` or `v*` tags. The all-in-one image (`Dockerfile` + `docker-compose.standalone.yml`) is a separate deployment path from the Composer/Unraid setup.

## Gotchas

- `better-sqlite3` is a native addon — storage builder stage needs `python3 make g++`
- `excalidraw-room` has no custom code — just a Dockerfile that clones upstream at a pinned commit
- Frontend auto-detects latest Excalidraw release — if patches break, pin `EXCALIDRAW_VERSION` in `frontend/Dockerfile` or pass as build arg
- `.dockerignore` excludes `*.md` — this file won't end up in images
- `.env` is SOPS-encrypted and committed — Composer handles decrypt/re-encrypt lifecycle
- Excalidraw uses hash-based routing (`/#room=xxx`) — busybox httpd works without SPA fallback
