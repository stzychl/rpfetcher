# ============================================================
# Multi-stage Docker build for Spreadsheet Monitor
# ============================================================

# --- Stage 1: Build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# --- Stage 2: Production image ---
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup -S monitor && adduser -S monitor -G monitor

# Copy compiled output and production deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create required directories
RUN mkdir -p logs state/history && chown -R monitor:monitor /app

USER monitor

# Expose the dashboard port
EXPOSE 3000

# Health check — checks the /status endpoint
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/status || exit 1

CMD ["node", "dist/index.js"]
