# Set empty to auto-detect latest release tag at build time.
# Pin to a specific tag (e.g. v0.18.0) if patches break on a newer version.
ARG EXCALIDRAW_VERSION=

# ==============================================================================
# Build Excalidraw frontend
# ==============================================================================
FROM node:18 AS builder

ARG EXCALIDRAW_VERSION

WORKDIR /app

# Resolve latest release tag via git ls-remote (no GitHub API rate limits)
RUN if [ -z "$EXCALIDRAW_VERSION" ]; then \
      EXCALIDRAW_VERSION=$(git ls-remote --tags --sort=-v:refname \
        https://github.com/excalidraw/excalidraw.git 'v*' \
        | head -1 | sed 's|.*refs/tags/||'); \
      echo "Auto-detected latest Excalidraw: ${EXCALIDRAW_VERSION}"; \
    fi && \
    git clone --depth 1 --branch "${EXCALIDRAW_VERSION}" \
      https://github.com/excalidraw/excalidraw.git . && \
    echo "${EXCALIDRAW_VERSION}" > /tmp/excalidraw-version

# Fail fast if upstream file structure changed
RUN test -f /app/excalidraw-app/data/firebase.ts && \
    test -f /app/excalidraw-app/components/ExportToExcalidrawPlus.tsx && \
    test -f /app/excalidraw-app/index.html || \
    (echo "ERROR: Excalidraw file structure changed - patches need updating for ${EXCALIDRAW_VERSION}" && exit 1)

# Full file replacements (not diffs)
COPY patches/firebase.ts /app/excalidraw-app/data/firebase.ts
COPY patches/ExportToExcalidrawPlus.tsx /app/excalidraw-app/components/ExportToExcalidrawPlus.tsx
COPY patches/index.html /app/excalidraw-app/index.html

RUN yarn install --network-timeout 600000

# Empty = relative paths (same-origin); external reverse proxy handles routing
ARG VITE_APP_WS_SERVER_URL=
ARG VITE_APP_BACKEND_V2_GET_URL=
ARG VITE_APP_BACKEND_V2_POST_URL=
ARG VITE_APP_AI_BACKEND=
ARG VITE_APP_DISABLE_TRACKING=true

RUN echo "MODE=production" > .env.production && \
    echo "VITE_APP_WS_SERVER_URL=${VITE_APP_WS_SERVER_URL}" >> .env.production && \
    echo "VITE_APP_BACKEND_V2_GET_URL=${VITE_APP_BACKEND_V2_GET_URL}" >> .env.production && \
    echo "VITE_APP_BACKEND_V2_POST_URL=${VITE_APP_BACKEND_V2_POST_URL}" >> .env.production && \
    echo "VITE_APP_AI_BACKEND=${VITE_APP_AI_BACKEND}" >> .env.production && \
    echo "VITE_APP_DISABLE_TRACKING=${VITE_APP_DISABLE_TRACKING}" >> .env.production && \
    echo "VITE_APP_ENABLE_TRACKING=false" >> .env.production

RUN yarn build:app:docker

# Bundle fonts locally (node:18 has HTTPS support for wget)
RUN mkdir -p /app/excalidraw-app/build/fonts/Assistant && \
    wget -q -O /app/excalidraw-app/build/fonts/Assistant/Assistant-Regular.woff2 \
      "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/fonts/Assistant/Assistant-Regular.woff2" && \
    wget -q -O /app/excalidraw-app/build/fonts/Assistant/Assistant-Medium.woff2 \
      "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/fonts/Assistant/Assistant-Medium.woff2" && \
    wget -q -O /app/excalidraw-app/build/fonts/Assistant/Assistant-SemiBold.woff2 \
      "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/fonts/Assistant/Assistant-SemiBold.woff2" && \
    wget -q -O /app/excalidraw-app/build/fonts/Assistant/Assistant-Bold.woff2 \
      "https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/fonts/Assistant/Assistant-Bold.woff2" && \
    find /app/excalidraw-app/build -name '*.html' -o -name '*.css' | xargs sed -i \
      's|https://excalidraw.nyc3.cdn.digitaloceanspaces.com/oss/||g'

# ==============================================================================
# Minimal static file server
# ==============================================================================
FROM busybox:stable-musl

COPY --from=builder /app/excalidraw-app/build /srv

# MIME types busybox httpd doesn't know natively
RUN printf '.woff2:font/woff2\n.woff:font/woff\n.ttf:font/ttf\n.wasm:application/wasm\n.webp:image/webp\n.avif:image/avif\n' > /etc/httpd.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1

CMD ["busybox", "httpd", "-f", "-p", "80", "-h", "/srv", "-c", "/etc/httpd.conf"]
