# CallA.I.d — single-image deploy for any container host (Render / Railway / Fly /
# a plain VM). Builds the React SPA, installs the server (with native SQLite),
# then runs the Express API which serves the built SPA and the live WebSocket on
# one port. NOTE: the app is stateful (persistent process + WebSocket + SQLite) —
# this is the right deploy shape for it; Vercel's serverless model is not.

# ---- 1. Build the frontend ----
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- 2. Install server deps (native better-sqlite3) ----
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
# Build toolchain in case a prebuilt better-sqlite3 binary isn't available.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci --omit=dev

# ---- 3. Runtime ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=4000 CALLAID_DB=/app/server/data/callaid.db
WORKDIR /app
COPY server/package*.json ./server/
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/src ./server/src
COPY --from=web /app/web/dist ./web/dist
RUN mkdir -p /app/server/data
EXPOSE 4000
# Seed is idempotent (no-op once the DB has data). Mount a volume at
# /app/server/data to persist across restarts; otherwise it reseeds on boot.
CMD ["sh", "-c", "node server/src/seed.js && node server/src/index.js"]
