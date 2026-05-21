# Multi-stage build for Vue web app served by Nginx

# ----- Stage 1: deps + build -----
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/
COPY packages/schema/package.json ./packages/schema/
COPY packages/template-renderer/package.json ./packages/template-renderer/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @template-printing/web build

# ----- Stage 2: runtime (Nginx) -----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
