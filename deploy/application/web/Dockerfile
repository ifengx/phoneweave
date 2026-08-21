FROM node:22-alpine

WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY web-console/dist ./web-console/dist

EXPOSE 8787
CMD ["node", "server/src/server.mjs"]
