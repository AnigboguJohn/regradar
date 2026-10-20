# Build context: repository root (so the SQL migrations can be copied in)
FROM node:22-alpine AS build
WORKDIR /srv
COPY services/api/package*.json ./
RUN npm ci || npm install
COPY services/api/tsconfig.json ./
COPY services/api/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production MIGRATIONS_DIR=/srv/migrations
WORKDIR /srv
COPY --from=build /srv/node_modules ./node_modules
COPY --from=build /srv/dist ./dist
COPY services/api/package.json ./
COPY db/migrations ./migrations
COPY services/api/assets ./assets
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:4000/healthz || exit 1
CMD ["node", "dist/index.js"]
