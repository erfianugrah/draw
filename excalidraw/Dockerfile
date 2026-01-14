FROM node:18 AS build

WORKDIR /app

# Clone excalidraw
RUN git clone --depth 1 https://github.com/excalidraw/excalidraw.git .

# Install dependencies
RUN yarn install --network-timeout 600000

# Build args for configuration
ARG VITE_APP_WS_SERVER_URL=http://localhost:3002
ARG VITE_APP_BACKEND_V2_GET_URL=http://localhost:3003/api/v2/
ARG VITE_APP_BACKEND_V2_POST_URL=http://localhost:3003/api/v2/post/
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

# Production stage
FROM nginx:1.27-alpine

# Copy built files
COPY --from=build /app/excalidraw-app/build /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK CMD wget -q -O /dev/null http://localhost || exit 1

CMD ["nginx", "-g", "daemon off;"]
