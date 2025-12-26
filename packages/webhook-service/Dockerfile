FROM node:20-alpine AS builder

WORKDIR /build

# Copy package files
COPY package.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/webhook-service/package.json ./packages/webhook-service/

# Install dependencies
RUN npm install

# Copy source files
COPY tsconfig.json ./
COPY packages/core/ ./packages/core/
COPY packages/webhook-service/ ./packages/webhook-service/

# Build
RUN npm run build

# Production image
FROM node:20-alpine

RUN apk add --no-cache \
    ca-certificates \
    docker-cli \
    curl \
    gzip

WORKDIR /app

# Copy built files
COPY --from=builder /build/packages/core/dist ./node_modules/@qualys/gitlab-core/dist
COPY --from=builder /build/packages/core/package.json ./node_modules/@qualys/gitlab-core/
COPY --from=builder /build/packages/webhook-service/dist ./dist
COPY --from=builder /build/packages/webhook-service/package.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Create non-root user
RUN addgroup -g 1000 qualys && \
    adduser -u 1000 -G qualys -s /bin/sh -D qualys && \
    mkdir -p /home/qualys/.qscanner && \
    chown -R qualys:qualys /home/qualys /app

USER qualys

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["node", "/app/dist/index.js"]
