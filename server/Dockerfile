FROM node:22-alpine AS web-build
WORKDIR /app
COPY web-console/package.json ./web-console/package.json
RUN cd web-console && npm install
COPY web-console ./web-console
RUN cd web-console && npm run build

FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev
COPY server ./server
COPY --from=web-build /app/web-console/dist ./web-console/dist
EXPOSE 8787
CMD ["node", "server/src/server.mjs"]
