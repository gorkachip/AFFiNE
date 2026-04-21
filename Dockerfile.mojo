# syntax=docker/dockerfile:1.7
# Self-contained build for MOJO Notion - builds everything inside container

FROM node:22-bookworm AS builder
WORKDIR /app

# System deps for native module compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  curl \
  ca-certificates \
  pkg-config \
  libssl-dev \
  python3 \
  git \
  && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.94.0
ENV PATH="/root/.cargo/bin:${PATH}"

# Enable yarn via corepack
RUN corepack enable

# Copy source
COPY . /app

# Install dependencies (full install, not production-only, because we need to build)
RUN yarn install --immutable

# Build native Rust module
RUN yarn affine @affine/server-native build

# Rename native module so server bundler resolves all 3 arch branches.
# We only built one binary; alias all three names to it.
RUN if [ -f /app/packages/backend/native/server-native.node ]; then \
      cp /app/packages/backend/native/server-native.node /app/packages/backend/native/server-native.x64.node && \
      cp /app/packages/backend/native/server-native.node /app/packages/backend/native/server-native.arm64.node && \
      cp /app/packages/backend/native/server-native.node /app/packages/backend/native/server-native.armv7.node; \
    fi

# Build all frontends + backend
RUN yarn affine @affine/web build
RUN yarn affine @affine/admin build
RUN yarn affine @affine/mobile build
RUN yarn affine @affine/server build

# Install production-only deps in a separate node_modules
RUN yarn config set --json supportedArchitectures.cpu '["x64"]' && \
    yarn config set --json supportedArchitectures.libc '["glibc"]' && \
    yarn workspaces focus @affine/server --production

# Generate Prisma client for production
RUN yarn workspace @affine/server prisma generate

# Move node_modules into server folder so the runtime image can use it
RUN cp -r ./node_modules ./packages/backend/server/node_modules

# Run AFFiNE's docker-clean script to prune unused arch binaries
RUN AFFINE_DOCKER_CLEAN=1 TARGETARCH=amd64 node ./packages/backend/server/scripts/docker-clean.mjs || true

# ---------- Runtime image ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl \
  libjemalloc2 \
  ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy built backend (with bundled deps + frontends + native module)
COPY --from=builder /app/packages/backend/server /app
COPY --from=builder /app/packages/frontend/apps/web/dist /app/static
COPY --from=builder /app/packages/frontend/admin/dist /app/static/admin
COPY --from=builder /app/packages/frontend/apps/mobile/dist /app/static/mobile

# Enable jemalloc preload (matches official AFFiNE image)
ENV LD_PRELOAD=libjemalloc.so.2

EXPOSE 3010

CMD ["node", "./dist/main.js"]
