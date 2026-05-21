# Multi-stage build for Puppeteer render worker

# ----- Stage 1: deps + build -----
FROM node:20-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/render/package.json ./apps/render/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @template-printing/render build

# ----- Stage 2: runtime with Chromium and Chinese fonts -----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install Chromium + 思源黑体 / 思源宋体 + fontconfig
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-noto-cjk \
      fonts-noto-cjk-extra \
      fonts-noto-color-emoji \
      ca-certificates \
      && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY --from=build /app/apps/render/dist ./dist
COPY --from=build /app/apps/render/package.json ./
COPY --from=build /app/apps/render/node_modules ./node_modules
COPY --from=build /app/packages ./packages

# Run as non-root for Chromium sandbox safety
RUN useradd -m -u 1001 render && chown -R render:render /app
USER render

CMD ["node", "dist/main.js"]
