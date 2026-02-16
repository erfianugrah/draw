# Codebase Audit - Self-Hosted Excalidraw

**Date:** 2026-02-16
**Branch:** `review/codebase-audit`
**Auditor:** Claude (automated review)
**Status:** All 16 findings resolved

---

## Project Overview

A fully self-hosted Excalidraw deployment at `draw.erfi.dev` replacing all cloud dependencies (Firebase, Excalidraw+, analytics) with local alternatives. 4 Docker services behind Caddy reverse proxy with Cloudflare DNS-01 TLS.

| Metric | Value |
|--------|-------|
| Total files (non-.git) | 16 |
| Lines of code | ~1,741 |
| Docker services | 4 |
| Excalidraw version | v0.18.0 |
| Caddy version | 2.10.0 |
| Node.js version | 18 |

---

## Architecture

```
Internet -> Cloudflare (DNS/Tunnel) -> Caddy (172.41.1.2)
                                         |
                +------------------------+------------------------+
                |                        |                        |
         excalidraw-ai:3004     excalidraw-room:3002    excalidraw-storage:3003
         (text-to-diagram,      (Socket.io collab)      (SQLite CRUD for
          wireframe-to-code)                              drawings/rooms/files)
```

### Services

| Service | Container | IP | Port | Purpose |
|---------|-----------|-----|------|---------|
| `caddy` | `excalidraw-caddy` | 172.41.1.2 | 80/443 | Reverse proxy + static frontend |
| `excalidraw-room` | `excalidraw-collab` | 172.41.1.3 | 3002 | Real-time collaboration (Socket.io) |
| `excalidraw-storage` | `excalidraw-storage` | 172.41.1.4 | 3003 | SQLite storage backend |
| `excalidraw-ai` | `excalidraw-ai` | 172.41.1.5 | 3004 | AI proxy (OpenAI/Anthropic/Ollama) |

### Caddy Routing

| Route | Backend | Notes |
|-------|---------|-------|
| `/api/ai/*` | `excalidraw-ai:3004` | `handle_path` strips prefix |
| `/api/*` | `excalidraw-storage:3003` | `handle_path` strips prefix |
| `/socket.io/*` | `excalidraw-room:3002` | WebSocket + polling |
| `/*` | Static files from `/srv` | SPA fallback to `index.html` |

---

## Patches (3 files replacing Excalidraw originals)

| Patch | Replaces | Purpose |
|-------|----------|---------|
| `patches/firebase.ts` | `excalidraw-app/data/firebase.ts` | Replaces Firebase with HTTP calls to self-hosted storage |
| `patches/ExportToExcalidrawPlus.tsx` | `excalidraw-app/components/ExportToExcalidrawPlus.tsx` | Replaces "Export to Excalidraw+" with self-hosted shareable links |
| `patches/index.html` | `excalidraw-app/index.html` | Removes analytics and Google Fonts for privacy |

---

## Storage Schema (SQLite)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `drawings` | `id TEXT PK`, `data BLOB` | Shared drawings via links |
| `rooms` | `id TEXT PK`, `iv BLOB`, `ciphertext BLOB` | Encrypted collab room state |
| `files` | `id TEXT PK`, `room_id TEXT FK` | Binary assets (images) |
| `exports` | `id TEXT PK`, `data BLOB` | Shareable export blobs |

---

## AI Service

Supports 3 providers (configured via `AI_PROVIDER`):

| Provider | Text Model | Vision Model |
|----------|-----------|--------------|
| OpenAI | `gpt-4o-mini` | `gpt-4o` |
| Anthropic | `claude-3-5-haiku-20241022` | `claude-sonnet-4-20250514` |
| Ollama | `llama3.2` | `llava` |

Endpoints: `/v1/ai/text-to-diagram/generate` (POST), `/v1/ai/diagram-to-code/generate` (POST)

---

## Findings

### Critical

- [x] **[C1] No version pinning for excalidraw-room**
  - `excalidraw-room/Dockerfile:9` -- `git clone --depth 1` always gets HEAD
  - **Fixed:** Pinned to commit `03ff435860b508d7cd9e005cfc90f7977ae2a593` via build ARG

- [x] **[C2] No lock files for custom services**
  - `excalidraw-storage/` and `excalidraw-ai/` had no `package-lock.json`
  - **Fixed:** Generated and committed `package-lock.json` for both services; Dockerfiles use `npm ci`

### High

- [x] **[H1] CORS origin reflection with credentials**
  - `Caddyfile:32,43,52` -- `{header.Origin}` reflected in `Access-Control-Allow-Origin`
  - **Fixed:** Replaced with `https://{$DOMAIN}` in all CORS headers

- [x] **[H2] No authentication on any endpoint**
  - All API endpoints were publicly accessible
  - **Fixed:** Added optional `API_KEY` env var; write endpoints (POST) require `X-API-Key` header when configured. Read endpoints remain open (data is encrypted client-side).

- [x] **[H3] Missing Content-Security-Policy header**
  - No CSP header, no XSS protection
  - **Fixed:** Added comprehensive CSP header + Permissions-Policy header to Caddyfile

### Medium

- [x] **[M1] Excalidraw+ redirect still in index.html**
  - `patches/index.html:72-81` -- Dead redirect to `app.excalidraw.com`
  - **Fixed:** Removed the entire script block

- [x] **[M2] In-memory rate limiting resets on restart**
  - `excalidraw-ai/index.js:14-33` -- Rate limit Map lost on container restart
  - **Fixed:** Rate limits now persist to JSON file in `/app/data/` volume; loaded on startup, saved every 5 min + on shutdown

- [x] **[M3] VACUUM runs on every cleanup cycle**
  - `excalidraw-storage/index.js:91` -- `VACUUM` rewrites entire DB
  - **Fixed:** Uses `PRAGMA incremental_vacuum` only when 100+ rows deleted; enabled `auto_vacuum = INCREMENTAL` mode

- [x] **[M4] No graceful shutdown handling**
  - Neither service handled SIGTERM/SIGINT
  - **Fixed:** Added `process.on('SIGTERM'/'SIGINT')` handlers to both services; storage closes DB, AI persists rate limits

- [x] **[M5] TZ default inconsistency**
  - `docker-compose.yml` defaulted to `Europe/Amsterdam`, `.env.example` to `UTC`
  - **Fixed:** All defaults now consistently use `UTC`

### Low

- [x] **[L1] No HEALTHCHECK on Caddy or AI containers**
  - Only room and storage had health checks
  - **Fixed:** Added HEALTHCHECK to `caddy/Dockerfile` and `excalidraw-ai/Dockerfile`; `depends_on` now uses `condition: service_healthy`

- [x] **[L2] Foreign keys not enforced in SQLite**
  - `FOREIGN KEY` declarations were decorative without pragma
  - **Fixed:** Added `db.pragma('foreign_keys = ON')` + `db.pragma('journal_mode = WAL')` after DB init

- [x] **[L3] Anthropic model defaults outdated**
  - Hardcoded `claude-3-haiku-20240307` and `claude-3-5-sonnet-20241022`
  - **Fixed:** Updated to `claude-3-5-haiku-20241022` (text) and `claude-sonnet-4-20250514` (vision) across all config files

- [x] **[L4] No request logging middleware**
  - No request logging in storage or AI services
  - **Fixed:** Added logging middleware that logs `[http] METHOD /path STATUS DURATIONms` on every request

- [x] **[L5] Patch fragility**
  - No validation that target files exist before patching
  - **Fixed:** Added `test -f` checks in `caddy/Dockerfile` that fail fast with an error message if file structure changed

- [x] **[L6] X-XSS-Protection header is deprecated**
  - `Caddyfile:18` -- Modern browsers removed support
  - **Fixed:** Removed `X-XSS-Protection`; replaced by CSP header (H3)

---

## Security Summary

### Strengths (original + new)
- End-to-end encryption (keys in URL fragments, never sent to server)
- Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, CSP, Permissions-Policy)
- Server header removed
- No analytics, external fonts, or CDN (privacy hardened)
- HTTPS enforced via Caddy auto-TLS with Cloudflare DNS-01
- No ports published to host (designed for tunnel use)
- AI rate limiting (per-IP daily limits, now persistent)
- **NEW:** Fixed CORS to only allow requests from the configured domain
- **NEW:** Optional API key authentication on write endpoints
- **NEW:** Content-Security-Policy prevents XSS
- **NEW:** Permissions-Policy restricts browser features
- **NEW:** Graceful shutdown prevents data corruption
- **NEW:** Health checks with `depends_on` conditions ensure startup ordering

### Remaining considerations
- API key auth is optional (disabled by default) -- deploy Cloudflare Access for stronger auth
- 50MB body limits on POST endpoints -- mitigated when API key is enabled
- Patch files are full replacements -- will need manual update when upgrading Excalidraw

---

## Files Changed

| File | Changes |
|------|---------|
| `excalidraw-room/Dockerfile` | Pinned to specific commit hash |
| `excalidraw-ai/Dockerfile` | Added `package-lock.json`, `npm ci`, HEALTHCHECK |
| `excalidraw-storage/Dockerfile` | Added `package-lock.json`, `npm ci` |
| `caddy/Dockerfile` | Added HEALTHCHECK, patch file validation |
| `excalidraw-ai/package-lock.json` | **NEW** -- generated lock file |
| `excalidraw-storage/package-lock.json` | **NEW** -- generated lock file |
| `Caddyfile` | Fixed CORS, added CSP + Permissions-Policy, removed X-XSS-Protection |
| `excalidraw-ai/index.js` | Persistent rate limits, API key auth, logging, graceful shutdown, updated model defaults |
| `excalidraw-storage/index.js` | FK enforcement, WAL mode, conditional vacuum, API key auth, logging, graceful shutdown |
| `docker-compose.yml` | TZ defaults to UTC, API_KEY env var, AI data volume, health conditions, updated model defaults |
| `.env.example` | Added API_KEY docs, updated Anthropic model defaults |
| `patches/index.html` | Removed Excalidraw+ redirect dead code |
| `.gitignore` | Added `node_modules/` |
