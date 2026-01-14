# Excalidraw Self-Hosted

A fully self-contained, self-hosted [Excalidraw](https://excalidraw.com) deployment with real-time collaboration and persistent storage. Replaces Firebase entirely with a custom SQLite backend.

## Features

- **Real-time collaboration** - Multiple users can draw together with live cursors
- **End-to-end encryption** - Server only stores encrypted blobs; keys stay in URLs
- **Persistent storage** - Drawings, rooms, and exports saved to SQLite database
- **Shareable links** - Full support for sharing drawings with encryption
- **Auto-cleanup** - Configurable retention policies for rooms, exports, and drawings
- **Auto-HTTPS** - Caddy handles SSL certificates via Cloudflare DNS-01
- **Single domain** - Everything runs on one domain, only ports 80/443 exposed
- **Docker-based** - Easy deployment with Docker Compose (3 containers)
- **ARM64 compatible** - Works on Raspberry Pi 5 and other ARM devices
- **No Firebase** - Completely self-hosted, no external dependencies
- **Privacy-first** - No analytics, no external CDN requests, no tracking

## Architecture

```
                    Internet
                        │
                        ▼
        ┌───────────────────────────────────────────┐
        │          Caddy (ports 80/443)             │
        │    Auto-HTTPS + Static Files + Proxy      │
        └───────────────────────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
          ▼             ▼             ▼
     ┌─────────┐  ┌───────────┐  ┌─────────┐
     │  /api/* │  │/socket.io/│  │   /*    │
     │         │  │           │  │         │
     │ Storage │  │  Collab   │  │ Static  │
     │ :3003   │  │  :3002    │  │ Files   │
     │ SQLite  │  │ Socket.io │  │ (Caddy) │
     └─────────┘  └───────────┘  └─────────┘
```

**Only ports 80 and 443 are exposed.** Caddy serves static files directly and proxies API/WebSocket requests internally.

### How Encryption Works

Excalidraw uses **client-side end-to-end encryption**. When you share a drawing:

1. Your browser generates a random encryption key
2. Drawing data is encrypted with this key before sending to the server
3. The key is stored in the URL fragment (after `#`) - **never sent to the server**
4. Recipients decrypt locally using the key from the URL

```
https://draw.example.com/#room=abc123,encryptionKey=xyz789
                              │                    │
                              ▼                    ▼
                      Sent to server     Stays in browser
                      (room lookup)      (decryption key)
```

**The server only sees encrypted blobs** - it cannot read your drawings.

### Deployment Options

**Option A: Direct exposure (ports 80/443)**
```
Internet → Your Server:80/443 → Caddy → Services
```

**Option B: Behind Cloudflare Tunnel (recommended)**
```
Internet → Cloudflare → Tunnel → Caddy (172.41.1.2) → Services
```

For Cloudflare Tunnel, the containers use static IPs on a dedicated subnet (172.41.1.0/24) for reliable routing.

## Prerequisites

- Docker and Docker Compose installed
- A domain with DNS managed by Cloudflare
- Cloudflare API token with DNS edit permissions

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/erfianugrah/draw.git
cd draw
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
DOMAIN=draw.yourdomain.com
BASE_URL=https://draw.yourdomain.com
CF_API_TOKEN=your_cloudflare_api_token
EMAIL=your_email@example.com
```

### 3. Point DNS to your server

Create an A record in Cloudflare:
- **Type:** A
- **Name:** draw (or your subdomain)
- **Content:** Your server's IP address
- **Proxy status:** DNS only (grey cloud) recommended for WebSocket

### 4. Build and deploy

```bash
docker compose up -d --build
```

First build takes **5-10 minutes** on x86 (longer on ARM devices like RPi5).

### 5. Access your instance

Visit `https://draw.yourdomain.com`

Caddy will automatically obtain SSL certificates via Cloudflare DNS-01 challenge.

## Getting a Cloudflare API Token

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **"Create Token"**
3. Use the **"Edit zone DNS"** template, or create a custom token:
   - **Permissions:** Zone → DNS → Edit
   - **Zone Resources:** Include → Specific zone → yourdomain.com
4. Copy the token to your `.env` file

## Configuration

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DOMAIN` | Your domain (used by Caddy) | *required* | `draw.example.com` |
| `BASE_URL` | Full URL with protocol | *required* | `https://draw.example.com` |
| `CF_API_TOKEN` | Cloudflare API token for DNS-01 | *required* | `abc123...` |
| `EMAIL` | Email for Let's Encrypt | *required* | `you@example.com` |
| `TZ` | Timezone for logs/cleanup | `UTC` | `Europe/Amsterdam` |
| `ROOM_MAX_AGE_DAYS` | Days to keep collaboration rooms | `30` | `7` |
| `EXPORT_MAX_AGE_DAYS` | Days to keep shared exports | `30` | `14` |
| `DRAWING_MAX_AGE_DAYS` | Days to keep saved drawings | `90` | `365` |
| `CLEANUP_INTERVAL_HOURS` | How often to run cleanup | `24` | `12` |

### Auto-Cleanup

The storage service automatically removes old data based on the retention settings above. Cleanup runs:
- On startup
- Every `CLEANUP_INTERVAL_HOURS` hours

Set any `*_MAX_AGE_DAYS` to `0` to disable cleanup for that data type.

### Customizing Excalidraw

To modify Excalidraw build options, edit `caddy/Dockerfile`. Available build args:

```dockerfile
ARG VITE_APP_WS_SERVER_URL        # WebSocket server URL
ARG VITE_APP_BACKEND_V2_GET_URL   # Storage GET endpoint
ARG VITE_APP_BACKEND_V2_POST_URL  # Storage POST endpoint
ARG VITE_APP_DISABLE_TRACKING     # Disable telemetry (default: true)
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| `caddy` | 80, 443 (exposed) | Reverse proxy, auto-HTTPS, static file server |
| `excalidraw-room` | 3002 (internal) | Real-time collaboration (Socket.io) |
| `excalidraw-storage` | 3003 (internal) | Storage API (SQLite + Express) |

## Data Persistence

Data is stored in Docker volumes:

| Volume | Contents |
|--------|----------|
| `excalidraw-data` | SQLite database with drawings |
| `caddy-data` | SSL certificates |
| `caddy-config` | Caddy configuration |

### Backup

```bash
# Backup drawings database
docker run --rm \
  -v draw_excalidraw-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/excalidraw-backup-$(date +%Y%m%d).tar.gz /data

# Restore
docker run --rm \
  -v draw_excalidraw-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/excalidraw-backup-YYYYMMDD.tar.gz -C /
```

## Commands

```bash
# Start services (uses cached images)
docker compose up -d

# Build and start (first time or after changes)
docker compose up -d --build

# Stop services
docker compose down

# View logs
docker compose logs -f
docker compose logs -f caddy

# Rebuild from scratch
docker compose build --no-cache
docker compose up -d

# Remove everything including data
docker compose down -v
```

## Updating

To update to the latest Excalidraw version:

```bash
docker compose build --no-cache caddy excalidraw-room
docker compose up -d
```

**Note:** This project patches Excalidraw to replace Firebase with the self-hosted backend. If Excalidraw makes significant changes to `excalidraw-app/data/firebase.ts` or `excalidraw-app/components/ExportToExcalidrawPlus.tsx`, the patches in `patches/` may need updating.

## Troubleshooting

### SSL Certificate Issues

```bash
docker compose logs caddy | grep -i "error\|certificate\|acme"
```

Common issues:
- **Invalid API token:** Verify CF_API_TOKEN has Zone:DNS:Edit permissions
- **DNS not propagated:** Wait a few minutes for DNS changes to propagate
- **Rate limited:** Let's Encrypt has rate limits; wait an hour and retry

### Collaboration Not Working

1. Check WebSocket in browser DevTools → Network → WS tab
2. Verify excalidraw-room is running: `docker compose logs excalidraw-room`
3. Ensure Cloudflare proxy is disabled (grey cloud) or WebSocket is enabled

### Storage Errors ("Couldn't save to backend")

```bash
# Check storage service
docker compose logs excalidraw-storage

# Test the API
curl -X POST https://yourdomain.com/api/v2/post/ \
  -H "Content-Type: application/json" \
  -d '{"test":"data"}'
```

### Rebuild From Scratch

```bash
docker compose down -v
docker rmi $(docker images 'draw-*' -q) 2>/dev/null
docker compose up -d --build
```

## Project Structure

```
draw/
├── .env.example              # Environment template
├── .gitignore
├── Caddyfile                 # Reverse proxy + static file config
├── docker-compose.yml        # Service orchestration
├── README.md
├── caddy/
│   └── Dockerfile            # Caddy + Cloudflare + Excalidraw build
├── excalidraw-room/
│   └── Dockerfile            # Collaboration server
├── excalidraw-storage/
│   ├── Dockerfile            # Storage API
│   ├── index.js              # Express + SQLite + auto-cleanup
│   └── package.json
└── patches/
    ├── firebase.ts           # Replaces Firebase with self-hosted API
    ├── ExportToExcalidrawPlus.tsx  # Local share instead of Excalidraw+
    └── index.html            # Removes analytics and external CDN
```

### API Endpoints

The storage service exposes:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v2/` | GET | Health check with cleanup config |
| `/api/v2/post/` | POST | Save a drawing (returns ID) |
| `/api/v2/:id` | GET | Retrieve a drawing |
| `/api/v2/rooms/:roomId` | GET/POST | Room state for collaboration |
| `/api/v2/files/*` | GET/POST | File/asset storage |
| `/api/v2/exports/:id` | GET/POST | Shareable export storage |

### Database Schema

SQLite stores four tables:
- **drawings** - Shared drawings (from "Share" link)
- **rooms** - Collaboration room state (encrypted)
- **files** - Binary assets (images, etc.)
- **exports** - Shareable exports

## Cloudflare Tunnel Setup (Optional)

If you're running behind a Cloudflare Tunnel instead of exposing ports directly:

1. Create a tunnel in Cloudflare Zero Trust dashboard
2. Configure the tunnel to route to Caddy's static IP:
   ```yaml
   # In your tunnel config
   ingress:
     - hostname: draw.yourdomain.com
       service: https://172.41.1.2:443
       originRequest:
         noTLSVerify: true
   ```
3. The docker-compose.yml already assigns static IPs:
   - `172.41.1.2` - Caddy
   - `172.41.1.3` - excalidraw-room
   - `172.41.1.4` - excalidraw-storage

## Privacy

This deployment makes **zero external requests**:

- **No analytics** - Simple Analytics script removed
- **No external fonts** - All fonts bundled locally (Excalifont, Assistant, etc.)
- **No CDN dependencies** - Everything served from your server
- **No tracking** - `VITE_APP_DISABLE_TRACKING=true` by default

Your drawings stay on your server. The only network traffic is between your users and your server.

## Security Notes

- **Encryption keys never leave the browser** - The server cannot decrypt drawings
- **No authentication built-in** - Consider adding Cloudflare Access or a reverse proxy auth
- **SQLite file permissions** - The data volume contains all user data; secure accordingly
- **HTTPS required** - Encryption keys in URLs are only safe over HTTPS
- **Security headers** - Caddy adds X-Frame-Options, X-Content-Type-Options, etc.
- **Referrer-Policy** - Set to prevent leaking URLs containing encryption keys

## License

- **Excalidraw:** MIT License
- **excalidraw-room:** MIT License
- **This deployment setup:** MIT License
