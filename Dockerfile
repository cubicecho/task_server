# syntax=docker/dockerfile:1

# ─── Stage 1: build the client bundle ────────────────────────────────────────
# Debian slim rather than alpine: the build runs vite and tsc, and musl has a
# habit of surprising one dependency in ten. The image is bigger; the build is
# boring, which is worth more.
FROM node:26-slim AS builder

WORKDIR /app

# Manifests first so a source-only change reuses the install layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `build` is typecheck + vite build. It writes dist/, which the server hands to
# anything that isn't /graphql or /mcp.
RUN npm run build

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:26-slim

WORKDIR /app

ENV NODE_ENV=production

# Production dependencies only. tsx stays a devDependency and is not here:
# Node runs the server's TypeScript directly by stripping the types (26 does
# this without a flag), and nothing under server/ uses syntax that survives
# erasure. If that ever changes — an enum, a parameter property — the fix is to
# move tsx into dependencies and make the CMD `npx tsx server/index.ts`.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server server
COPY --from=builder /app/dist dist

# The embedded postgres, and anything else the server writes, lives on the
# volume rather than in the image's writable layer, which a `docker run` throws
# away. With DATABASE_URL set there is nothing here worth keeping.
ENV TASK_SERVER_DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data

EXPOSE 8787

# A GraphQL query, not a TCP probe: it round-trips to the database, so a
# postgres the process can no longer reach counts as unhealthy. Uses node,
# already here, rather than adding curl to a slim base.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/graphql',{method:'POST',headers:{'content-type':'application/json'},body:'{\"query\":\"{tasks{id}}\"}'}).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "server/index.ts"]
