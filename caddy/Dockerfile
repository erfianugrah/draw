ARG VERSION=2.10.0
ARG EXCALIDRAW_VERSION=v0.18.0

# Build Caddy with Cloudflare DNS plugin
FROM caddy:${VERSION}-builder AS caddy-builder
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare

# Build Excalidraw frontend
FROM node:18 AS excalidraw-builder

ARG EXCALIDRAW_VERSION

WORKDIR /app

# Clone excalidraw at specific version
RUN git clone --depth 1 --branch ${EXCALIDRAW_VERSION} https://github.com/excalidraw/excalidraw.git .

# Verify expected files exist before patching (fail fast if structure changed) [L5]
RUN test -f /app/excalidraw-app/data/firebase.ts && \
    test -f /app/excalidraw-app/components/ExportToExcalidrawPlus.tsx && \
    test -f /app/excalidraw-app/index.html || \
    (echo "ERROR: Excalidraw file structure changed - patches need updating for ${EXCALIDRAW_VERSION}" && exit 1)

# Copy our patches (full file replacements targeting EXCALIDRAW_VERSION)
# - firebase.ts: Replaces Firebase with self-hosted storage
# - ExportToExcalidrawPlus.tsx: Local share instead of Excalidraw+
# - index.html: Removes analytics and external CDN references for privacy
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

# Final image: Caddy with static files
FROM caddy:${VERSION}-alpine

# Copy custom Caddy binary with Cloudflare plugin
COPY --from=caddy-builder /usr/bin/caddy /usr/bin/caddy

# Copy Excalidraw static files
COPY --from=excalidraw-builder /app/excalidraw-app/build /srv

# Bundle fonts locally and rewrite CDN URLs so no external requests are made.
# The build bundles most fonts but the Assistant UI font variants are CDN-only.
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

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:2019/config/ || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
