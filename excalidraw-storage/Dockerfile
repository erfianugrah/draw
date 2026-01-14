FROM node:18-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install --production

# Copy source
COPY index.js ./

# Create data directory for SQLite
RUN mkdir -p /app/data

# Environment
ENV PORT=3003
ENV DB_PATH=/app/data/excalidraw.db
ENV CORS_ORIGIN=*

EXPOSE 3003

# Volume for persistent data
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:${PORT}/ || exit 1

CMD ["node", "index.js"]
