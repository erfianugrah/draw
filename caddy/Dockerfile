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

# Copy our patches
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
ARG VITE_APP_DISABLE_TRACKING=true

# Create production env file
RUN echo "MODE=production" > .env.production && \
    echo "VITE_APP_WS_SERVER_URL=${VITE_APP_WS_SERVER_URL}" >> .env.production && \
    echo "VITE_APP_BACKEND_V2_GET_URL=${VITE_APP_BACKEND_V2_GET_URL}" >> .env.production && \
    echo "VITE_APP_BACKEND_V2_POST_URL=${VITE_APP_BACKEND_V2_POST_URL}" >> .env.production && \
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

EXPOSE 80 443

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
