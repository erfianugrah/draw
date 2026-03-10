ARG VERSION=2.10.0
ARG EXCALIDRAW_VERSION=v0.18.0
ARG S6_OVERLAY_VERSION=3.2.0.2

# ==============================================================================
# Stage 1: Build Caddy with Cloudflare DNS plugin
# ==============================================================================
FROM caddy:${VERSION}-builder AS caddy-builder
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

# ==============================================================================
# Stage 2: Build Excalidraw frontend
# ==============================================================================
FROM node:18 AS excalidraw-builder

ARG EXCALIDRAW_VERSION

WORKDIR /app

# Clone excalidraw at specific version
RUN git clone --depth 1 --branch ${EXCALIDRAW_VERSION} https://github.com/excalidraw/excalidraw.git .

# Verify expected files exist before patching (fail fast if structure changed)
RUN test -f /app/excalidraw-app/data/firebase.ts && \
    test -f /app/excalidraw-app/components/ExportToExcalidrawPlus.tsx && \
    test -f /app/excalidraw-app/index.html || \
    (echo "ERROR: Excalidraw file structure changed - patches need updating for ${EXCALIDRAW_VERSION}" && exit 1)

# Copy our patches (full file replacements targeting EXCALIDRAW_VERSION)
COPY patches/firebase.ts /app/excalidraw-app/data/firebase.ts
COPY patches/ExportToExcalidrawPlus.tsx /app/excalidraw-app/components/ExportToExcalidrawPlus.tsx
COPY patches/index.html /app/excalidraw-app/index.html

# Install dependencies
RUN yarn install --network-timeout 600000

# Build args for configuration
ARG VITE_APP_WS_SERVER_URL
ARG VITE_APP_BACKEND_V2_GET_URL
ARG VITE_APP_BACKEND_V2_POST_URL
ARG VITE_APP_AI_BACKEND
ARG VITE_APP_DISABLE_TRACKING=true

# Create production env file
RUN echo "MODE=production" > .env.production && \
    echo "VITE_APP_WS_SERVER_URL=${VITE_APP_WS_SERVER_URL}" >> .env.production && \
    echo "VITE_APP_BACKEND_V2_GET_URL=${VITE_APP_BACKEND_V2_GET_URL}" >> .env.production && \
    echo "VITE_APP_BACKEND_V2_POST_URL=${VITE_APP_BACKEND_V2_POST_URL}" >> .env.production && \
    echo "VITE_APP_AI_BACKEND=${VITE_APP_AI_BACKEND}" >> .env.production && \
    echo "VITE_APP_DISABLE_TRACKING=${VITE_APP_DISABLE_TRACKING}" >> .env.production && \
    echo "VITE_APP_ENABLE_TRACKING=false" >> .env.production

# Build the app
RUN yarn build:app:docker

# ==============================================================================
# Stage 3: Build excalidraw-room from source
# ==============================================================================
FROM node:18-alpine AS room-builder

ARG EXCALIDRAW_ROOM_COMMIT=03ff435860b508d7cd9e005cfc90f7977ae2a593

RUN apk add --no-cache git

WORKDIR /app

RUN git clone https://github.com/excalidraw/excalidraw-room.git . && \
    git checkout ${EXCALIDRAW_ROOM_COMMIT}

RUN yarn install --frozen-lockfile && yarn build

# Re-install production deps only for the final image
RUN rm -rf node_modules && yarn install --production --frozen-lockfile

# ==============================================================================
# Stage 4: Install storage dependencies (needs native compilation)
# ==============================================================================
FROM node:18-alpine AS storage-builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY excalidraw-storage/package.json excalidraw-storage/package-lock.json ./
RUN npm ci --production

# ==============================================================================
# Stage 5: Install AI dependencies
# ==============================================================================
FROM node:18-alpine AS ai-builder

WORKDIR /app

COPY excalidraw-ai/package.json excalidraw-ai/package-lock.json ./
RUN npm ci --production

# ==============================================================================
# Stage 6: Final all-in-one image
# ==============================================================================
FROM node:18-alpine

ARG S6_OVERLAY_VERSION
ARG TARGETARCH

LABEL maintainer="erfianugrah"
LABEL org.opencontainers.image.source="https://github.com/erfianugrah/draw"
LABEL org.opencontainers.image.description="Self-hosted Excalidraw with collaboration, storage, and AI"

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    wget \
    libstdc++

# Install s6-overlay for process management
# Map Docker TARGETARCH to s6-overlay arch names
ADD https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz /tmp
RUN tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz && rm /tmp/s6-overlay-noarch.tar.xz

RUN S6_ARCH="$(case ${TARGETARCH} in amd64) echo x86_64;; arm64) echo aarch64;; *) echo ${TARGETARCH};; esac)" && \
    wget -q -O /tmp/s6-overlay-arch.tar.xz \
      "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" && \
    tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz && rm /tmp/s6-overlay-arch.tar.xz

# Copy Caddy binary
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy

# ==============================================================================
# Frontend static files
# ==============================================================================
COPY --from=excalidraw-builder /app/excalidraw-app/build /srv

# Bundle fonts locally (rewrite CDN URLs so no external requests are made)
RUN mkdir -p /srv/fonts/Assistant && \
    wget -q -O /srv/fonts/Assistant/Assistant-Regular.woff2 \
      "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/fonts/Assistant/Assistant-Regular.woff2" && \
    wget -q -O /srv/fonts/Assistant/Assistant-Medium.woff2 \
      "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/fonts/Assistant/Assistant-Medium.woff2" && \
    wget -q -O /srv/fonts/Assistant/Assistant-SemiBold.woff2 \
      "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/fonts/Assistant/Assistant-SemiBold.woff2" && \
    wget -q -O /srv/fonts/Assistant/Assistant-Bold.woff2 \
      "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/fonts/Assistant/Assistant-Bold.woff2" && \
    find /srv -name '*.html' -o -name '*.css' | xargs sed -i \
      's|https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/||g'

# ==============================================================================
# Excalidraw Room (collaboration)
# ==============================================================================
WORKDIR /opt/room
COPY --from=room-builder /app/dist ./dist
COPY --from=room-builder /app/node_modules ./node_modules
COPY --from=room-builder /app/package.json ./

# ==============================================================================
# Excalidraw Storage
# ==============================================================================
WORKDIR /opt/storage
COPY --from=storage-builder /app/node_modules ./node_modules
COPY excalidraw-storage/package.json ./
COPY excalidraw-storage/index.js ./
RUN mkdir -p /opt/storage/data

# ==============================================================================
# Excalidraw AI
# ==============================================================================
WORKDIR /opt/ai
COPY --from=ai-builder /app/node_modules ./node_modules
COPY excalidraw-ai/package.json ./
COPY excalidraw-ai/index.js ./
RUN mkdir -p /opt/ai/data

# ==============================================================================
# s6-overlay service definitions
# ==============================================================================

# --- Caddy ---
RUN mkdir -p /etc/s6-overlay/s6-rc.d/caddy /etc/s6-overlay/s6-rc.d/user/contents.d
COPY s6/caddy/run /etc/s6-overlay/s6-rc.d/caddy/run
RUN chmod +x /etc/s6-overlay/s6-rc.d/caddy/run
RUN echo "longrun" > /etc/s6-overlay/s6-rc.d/caddy/type
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/caddy

# --- Room ---
RUN mkdir -p /etc/s6-overlay/s6-rc.d/room
COPY s6/room/run /etc/s6-overlay/s6-rc.d/room/run
RUN chmod +x /etc/s6-overlay/s6-rc.d/room/run
RUN echo "longrun" > /etc/s6-overlay/s6-rc.d/room/type
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/room

# --- Storage ---
RUN mkdir -p /etc/s6-overlay/s6-rc.d/storage
COPY s6/storage/run /etc/s6-overlay/s6-rc.d/storage/run
RUN chmod +x /etc/s6-overlay/s6-rc.d/storage/run
RUN echo "longrun" > /etc/s6-overlay/s6-rc.d/storage/type
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/storage

# --- AI ---
RUN mkdir -p /etc/s6-overlay/s6-rc.d/ai
COPY s6/ai/run /etc/s6-overlay/s6-rc.d/ai/run
RUN chmod +x /etc/s6-overlay/s6-rc.d/ai/run
RUN echo "longrun" > /etc/s6-overlay/s6-rc.d/ai/type
RUN touch /etc/s6-overlay/s6-rc.d/user/contents.d/ai

# ==============================================================================
# Embedded Caddyfile for internal routing
# ==============================================================================
COPY Caddyfile.embedded /etc/caddy/Caddyfile

# ==============================================================================
# Data volumes
# ==============================================================================
VOLUME ["/opt/storage/data", "/opt/ai/data", "/data/caddy"]

# ==============================================================================
# Default environment variables
# ==============================================================================
ENV PORT_ROOM=3002 \
    PORT_STORAGE=3003 \
    PORT_AI=3004 \
    TZ=UTC \
    CORS_ORIGIN=* \
    AI_PROVIDER=openai \
    AI_RATE_LIMIT_PER_DAY=100 \
    ROOM_MAX_AGE_DAYS=30 \
    EXPORT_MAX_AGE_DAYS=30 \
    DRAWING_MAX_AGE_DAYS=90 \
    CLEANUP_INTERVAL_HOURS=24 \
    XDG_DATA_HOME=/data/caddy \
    XDG_CONFIG_HOME=/data/caddy

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:2019/config/ || exit 1

ENTRYPOINT ["/init"]
