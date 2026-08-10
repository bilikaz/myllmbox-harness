# Build the static web app (the renderer, dual-target — here the pure-web build) and serve it with
# nginx. Build context is the REPO ROOT (the pnpm workspace), so the whole workspace is available to
# install + build; only apps/desktop/dist ships in the final image.

FROM node:24-alpine AS build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @myllmbox-harness/desktop build

FROM nginx:alpine
COPY docker/prod/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/desktop/dist /usr/share/nginx/html
EXPOSE 80
