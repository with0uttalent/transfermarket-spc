# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
# better-sqlite3 and canvas are native modules. They usually install from
# prebuilt binaries, but the toolchain + headers are here so the build also
# works when a prebuild is unavailable for the platform.
FROM node:22-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ pkg-config \
      libcairo2-dev libpango1.0-dev libjpeg62-turbo-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim

# Runtime libraries for canvas (image/text rendering) + curl for the healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 \
      librsvg2-2 libfontconfig1 fonts-dejavu-core curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY . .

# Persistent state (SQLite DB + user uploads) lives on the /data volume.
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/transfermarket.db \
    UPLOADS_DIR=/data/uploads

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
