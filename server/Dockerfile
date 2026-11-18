# Chess Arena game server.
# Build from the repository root (the server shares the protocol and chess rules with the app):
#   docker build -f server/Dockerfile -t chess-arena-server .
#   docker run -p 8080:8080 chess-arena-server

FROM node:22-alpine AS build
WORKDIR /repo
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY src/shared src/shared
COPY src/game/rules.ts src/game/rules.ts
COPY server server
RUN cd server && npm run typecheck && npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /repo/server/package.json ./
COPY --from=build /repo/server/node_modules node_modules
COPY --from=build /repo/server/dist dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]
