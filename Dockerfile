# hugmesh-forum-ui — builds the Forum native-federation REMOTE
# (src → dist/forum/browser) and serves it via nginx with CORS so the
# hugmesh.systems host can fetch its remoteEntry.json cross-origin.
# Deployed to the hugmesh-frontend namespace, fronted by the fe-gateway at
# /social/forum (a PATH remote — NOT a forum.<domain> subdomain, which the
# *.hugmesh.systems vanity wildcard would swallow). Consumes same-origin
# /bff/forum/** (the hugmesh-forum-bff-api wraps the headless phpBB backend).
# Angular CLI 22 requires Node >= 24.15.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:forum -- --base-href=/social/forum/

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/forum/browser /usr/share/nginx/html
EXPOSE 80
