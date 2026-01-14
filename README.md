# Excalidraw Self-Hosted

A fully self-contained, self-hosted [Excalidraw](https://excalidraw.com) deployment with real-time collaboration and persistent storage.

## Features

- **Real-time collaboration** - Multiple users can draw together with live cursors
- **Persistent storage** - Drawings saved to SQLite database (shareable links work)
- **Auto-HTTPS** - Caddy handles SSL certificates automatically via Cloudflare DNS-01
- **Single domain** - Everything runs on one domain, only ports 80/443 exposed
- **Docker-based** - Easy deployment with Docker Compose
- **Minimal footprint** - Only 3 containers (Caddy serves static files directly)
- **ARM64 compatible** - Works on Raspberry Pi 5 and other ARM devices

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

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your domain (used by Caddy) | `draw.example.com` |
| `BASE_URL` | Full URL with protocol | `https://draw.example.com` |
| `CF_API_TOKEN` | Cloudflare API token | `abc123...` |
| `EMAIL` | Email for Let's Encrypt | `you@example.com` |

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
└── excalidraw-storage/
    ├── Dockerfile            # Storage API
    ├── index.js              # Express + SQLite
    └── package.json
```

## License

- **Excalidraw:** MIT License
- **excalidraw-room:** MIT License
- **This deployment setup:** MIT License
