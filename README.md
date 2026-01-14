# Excalidraw Self-Hosted

A fully self-contained, self-hosted [Excalidraw](https://excalidraw.com) deployment with real-time collaboration and persistent storage.

## Features

- **Real-time collaboration** - Multiple users can draw together with live cursors
- **Persistent storage** - Drawings saved to SQLite database (shareable links work)
- **Auto-HTTPS** - Caddy handles SSL certificates automatically via Cloudflare DNS-01
- **Single domain** - Everything runs on one domain, only ports 80/443 exposed
- **Docker-based** - Easy deployment with Docker Compose
- **Minimal footprint** - Only 3 containers (Caddy serves static files directly)
- **CI/CD ready** - GitHub Actions workflow for building and pushing images

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

## Deployment Options

### Option A: Use Pre-built Images (Recommended)

Fastest deployment - pulls pre-built images from GitHub Container Registry.

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your values (DOMAIN, CF_API_TOKEN, EMAIL, GITHUB_USER)

# 2. Deploy
docker compose -f docker-compose.prod.yml up -d
```

### Option B: Build Locally

Build everything from source (takes 5-10 minutes).

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your values (DOMAIN, BASE_URL, CF_API_TOKEN, EMAIL)

# 2. Build and deploy
docker compose up -d --build
```

## Quick Start (Full Guide)

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
# Your domain
DOMAIN=draw.yourdomain.com

# Base URL (only needed for local builds)
BASE_URL=https://draw.yourdomain.com

# Cloudflare credentials
CF_API_TOKEN=your_cloudflare_api_token
EMAIL=your_email@example.com

# GitHub username (only needed for pre-built images)
GITHUB_USER=erfianugrah
```

### 3. Point DNS to your server

Create an A record in Cloudflare:
- **Type:** A
- **Name:** draw (or your subdomain)
- **Content:** Your server's IP address
- **Proxy status:** DNS only (grey cloud) recommended for WebSocket

### 4. Deploy

**Using pre-built images:**
```bash
docker compose -f docker-compose.prod.yml up -d
```

**Building locally:**
```bash
docker compose up -d --build
```

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

| Variable | Required For | Description | Example |
|----------|--------------|-------------|---------|
| `DOMAIN` | Both | Your domain (used by Caddy) | `draw.example.com` |
| `BASE_URL` | Local build | Full URL with protocol | `https://draw.example.com` |
| `CF_API_TOKEN` | Both | Cloudflare API token | `abc123...` |
| `EMAIL` | Both | Email for Let's Encrypt | `you@example.com` |
| `GITHUB_USER` | Pre-built | GitHub username for GHCR | `erfianugrah` |

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

## CI/CD with GitHub Actions

The repository includes a GitHub Actions workflow that automatically builds and pushes images to GHCR.

### Automatic builds

Images are built automatically when you push changes to:
- `caddy/`
- `excalidraw-room/`
- `excalidraw-storage/`

### Manual builds (different domain)

To build for a different domain:

1. Go to Actions → "Build and Push Images"
2. Click "Run workflow"
3. Enter your domain (e.g., `draw.example.com`)
4. Images will be tagged with your domain

### Image tags

| Image | Tags |
|-------|------|
| `ghcr.io/USER/excalidraw-caddy` | `latest`, `draw.example.com` |
| `ghcr.io/USER/excalidraw-room` | `latest` |
| `ghcr.io/USER/excalidraw-storage` | `latest` |

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
# === Using pre-built images ===
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml pull   # Update to latest images
docker compose -f docker-compose.prod.yml logs -f

# === Building locally ===
docker compose up -d --build
docker compose down
docker compose build --no-cache caddy   # Rebuild Caddy + frontend
docker compose logs -f

# === Common ===
docker compose ps                        # Check status
docker compose logs -f caddy             # View Caddy logs
docker compose down -v                   # Remove everything including data
```

## Updating

**Pre-built images:**
```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

**Local builds:**
```bash
docker compose build --no-cache caddy excalidraw-room
docker compose up -d
```

## Troubleshooting

### SSL Certificate Issues

Check Caddy logs:
```bash
docker compose logs caddy | grep -i "error\|certificate\|acme"
```

Common issues:
- **Invalid API token:** Verify CF_API_TOKEN has Zone:DNS:Edit permissions
- **DNS not propagated:** Wait a few minutes for DNS changes to propagate
- **Rate limited:** Let's Encrypt has rate limits; wait an hour and retry

### Collaboration Not Working

1. Check WebSocket in browser DevTools → Network → WS tab
2. Verify excalidraw-room is running:
   ```bash
   docker compose logs excalidraw-room
   ```
3. Ensure Cloudflare proxy is disabled (grey cloud) or WebSocket is enabled

### Storage Errors ("Couldn't save to backend")

1. Check storage service:
   ```bash
   docker compose logs excalidraw-storage
   ```
2. Test the API:
   ```bash
   curl -X POST https://yourdomain.com/api/v2/post/ \
     -H "Content-Type: application/json" \
     -d '{"test":"data"}'
   ```
3. Check SQLite database:
   ```bash
   docker exec excalidraw-storage ls -la /app/data/
   ```

### Container Won't Start

```bash
# Check container status
docker compose ps -a

# View startup logs
docker compose logs --tail=50 <service-name>

# Restart specific service
docker compose restart <service-name>
```

### Rebuild From Scratch

```bash
# Stop and remove everything
docker compose down -v

# Remove built images
docker rmi $(docker images 'draw-*' -q) 2>/dev/null

# Fresh build
docker compose up -d --build
```

## Project Structure

```
draw/
├── .env.example              # Environment template
├── .gitignore
├── Caddyfile                 # Reverse proxy + static file config
├── docker-compose.yml        # Local build orchestration
├── docker-compose.prod.yml   # Pre-built images orchestration
├── README.md
│
├── .github/
│   └── workflows/
│       └── build.yml         # CI/CD for building images
│
├── caddy/
│   └── Dockerfile            # Caddy + Cloudflare plugin + Excalidraw build
│
├── excalidraw-room/
│   └── Dockerfile            # Collaboration server build
│
└── excalidraw-storage/
    ├── Dockerfile            # Storage API container
    ├── index.js              # Express + SQLite API
    └── package.json
```

## Security Considerations

- **Cloudflare API token:** Keep `.env` secure and never commit it
- **CORS:** Storage and room servers allow all origins by default; restrict in production if needed
- **Database:** SQLite file is stored in a Docker volume; backup regularly
- **Updates:** Periodically rebuild/pull to get security patches from upstream

## License

- **Excalidraw:** MIT License
- **excalidraw-room:** MIT License
- **This deployment setup:** MIT License

## Credits

- [Excalidraw](https://github.com/excalidraw/excalidraw) - The amazing whiteboard app
- [excalidraw-room](https://github.com/excalidraw/excalidraw-room) - Collaboration server
- [Caddy](https://caddyserver.com/) - Automatic HTTPS reverse proxy
