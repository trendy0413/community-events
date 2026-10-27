# The web client, for `docker compose up` (SPEC section 15). Built with the
# repo root as context: the demo people come from ../seed/personas.json.
FROM node:24-alpine AS build

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
COPY seed/personas.json /app/seed/personas.json
RUN npm run build

# nginx serves the static build and forwards the API paths, so the browser
# sees one origin, as on the live demo (web/vercel.json).
FROM nginx:1.28-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
