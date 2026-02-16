FROM node:18-alpine AS build

ARG EXCALIDRAW_ROOM_COMMIT=03ff435860b508d7cd9e005cfc90f7977ae2a593

# Install git
RUN apk add --no-cache git

WORKDIR /app

# Clone excalidraw-room at pinned commit for reproducible builds
RUN git clone https://github.com/excalidraw/excalidraw-room.git . && \
    git checkout ${EXCALIDRAW_ROOM_COMMIT}

# Install dependencies
RUN yarn install --frozen-lockfile

# Build TypeScript
RUN yarn build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY --from=build /app/package.json /app/yarn.lock ./

# Install production dependencies only
RUN yarn install --production --frozen-lockfile

# Copy built files
COPY --from=build /app/dist ./dist

# Environment variables
ENV PORT=3002
ENV CORS_ORIGIN=*
ENV NODE_ENV=production

EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/ || exit 1

CMD ["node", "dist/index.js"]
