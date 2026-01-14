FROM node:18-alpine AS build

# Install git
RUN apk add --no-cache git

WORKDIR /app

# Clone excalidraw-room
RUN git clone --depth 1 https://github.com/excalidraw/excalidraw-room.git .

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
    CMD wget -q -O /dev/null http://localhost:${PORT}/ || exit 1

CMD ["node", "dist/index.js"]
