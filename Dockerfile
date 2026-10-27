# The API, for `docker compose up` (SPEC section 15). It runs the TypeScript
# sources through tsx, as `npm run dev` does, so there is no build step to
# drift from what the tests run.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# Dev dependencies included: tsx runs the server and the setup scripts.
RUN npm ci --ignore-scripts && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY migrations ./migrations
COPY seed ./seed

# The dev identity stub lets anyone who reaches the port act as any user, so
# docker-compose.yml publishes the port on the host's loopback only.
ENV AUTH_MODE=dev-stub \
    HOST=0.0.0.0 \
    PORT=3000

USER node
EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3000/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "--import", "tsx", "src/server.ts"]
