FROM node:20-alpine AS builder

WORKDIR /build

# Copy package files
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/gitlab-ci-component/package.json ./packages/gitlab-ci-component/

# Install dependencies
RUN npm install

# Copy source files
COPY tsconfig.json ./
COPY packages/core/ ./packages/core/
COPY packages/gitlab-ci-component/ ./packages/gitlab-ci-component/

# Build
RUN npm run build

# Production image
FROM node:20-alpine

# Install required tools for container scanning
RUN apk add --no-cache \
    ca-certificates \
    docker-cli \
    curl \
    gzip

WORKDIR /app

# Copy built files
COPY --from=builder /build/packages/core/dist ./node_modules/@qualys/gitlab-core/dist
COPY --from=builder /build/packages/core/package.json ./node_modules/@qualys/gitlab-core/
COPY --from=builder /build/packages/gitlab-ci-component/dist ./dist
COPY --from=builder /build/packages/gitlab-ci-component/package.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Create non-root user for security
RUN addgroup -g 1000 qualys && \
    adduser -u 1000 -G qualys -s /bin/sh -D qualys && \
    mkdir -p /home/qualys/.qscanner && \
    chown -R qualys:qualys /home/qualys /app

USER qualys

ENV NODE_ENV=production

ENTRYPOINT ["node", "/app/dist/index.js"]
