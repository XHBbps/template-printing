# Multi-stage Alpine build for the Puppeteer render worker.
# Slim image (< 1GB): Alpine base + system Chromium (apk) + Noto CJK font,
# prod-only self-contained node_modules via `pnpm deploy` (no dangling pnpm symlinks).
#
# China-friendly: apk repos default to the Aliyun mirror; override for overseas with
#   --build-arg APK_MIRROR=dl-cdn.alpinelinux.org

ARG APK_MIRROR=mirrors.aliyun.com

# ----- Stage 1: install deps + build + prod-prune (discarded) -----
FROM node:20-alpine AS build
ARG APK_MIRROR
ENV PUPPETEER_SKIP_DOWNLOAD=true
# Build toolchain for any node-gyp deps; this whole stage is discarded so size is irrelevant.
RUN sed -i "s|dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories \
    && apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json .npmrc ./
COPY apps/render/package.json ./apps/render/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile
COPY . .
# Build TS → dist, then produce a self-contained prod deployment (bundles workspace deps,
# strips devDependencies, real files instead of pnpm store symlinks). Target is OUTSIDE the
# workspace so pnpm deploy doesn't refuse an in-workspace path.
RUN pnpm --filter @template-printing/render build \
    && pnpm --filter @template-printing/render deploy --prod /prod/render

# ----- Stage 2: runtime with system Chromium + Noto CJK -----
FROM node:20-alpine AS runtime
ARG APK_MIRROR
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Chromium + its runtime libs + 思源黑体/思源宋体 (font-noto-cjk). No emoji font (intentionally
# dropped) and no fonts-noto-cjk-extra (rare glyphs) to keep the image small.
RUN sed -i "s|dl-cdn.alpinelinux.org|${APK_MIRROR}|g" /etc/apk/repositories \
    && apk add --no-cache \
       chromium \
       nss \
       freetype \
       harfbuzz \
       ca-certificates \
       ttf-freefont \
       font-noto-cjk \
    && rm -rf /var/cache/apk/*

WORKDIR /app
# Create the non-root user first so COPY --chown can set ownership inline
# (a separate `chown -R /app` would duplicate the whole app into an extra layer).
RUN addgroup -S render && adduser -S render -G render
COPY --from=build --chown=render:render /prod/render ./

# Run Chromium as non-root (launch already passes --no-sandbox).
USER render

CMD ["node", "dist/main.js"]
