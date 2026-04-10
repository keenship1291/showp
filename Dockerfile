# ── Stage 1: install production deps ─────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

# ── Stage 2: runtime image ────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Create image output directory and set ownership before switching user
RUN mkdir -p /app/images && chown -R node:node /app

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
