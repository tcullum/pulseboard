FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh docker-healthcheck.mjs ./

RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=20s --timeout=5s --start-period=25s --retries=3 CMD ["node", "/app/docker-healthcheck.mjs"]

ENTRYPOINT ["/app/docker-entrypoint.sh"]
