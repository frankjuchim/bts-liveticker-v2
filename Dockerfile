# BTS Liveticker als Docker-Image (ghcr.io/frankjuchim/bts-liveticker-v2).
# Start und Update: siehe docker-compose.yml und README („Docker“).
FROM node:22-alpine

# Version für die Anzeige im Admin-Panel (setzt der Build auf GitHub)
ARG VERSION_COMMIT=""
ARG VERSION_DATE=""
ARG VERSION_REPO="frankjuchim/bts-liveticker-v2"

ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY designs ./designs
COPY bts-patch ./bts-patch
RUN if [ -n "$VERSION_COMMIT" ]; then \
      printf '{"commit":"%s","date":"%s","repo":"%s","branch":"main"}\n' "$VERSION_COMMIT" "$VERSION_DATE" "$VERSION_REPO" > .version.json; \
    fi \
 && mkdir -p /data && chown node:node /data

# ohne root-Rechte; Port 8080 im Container (außen z. B. auf 80 legen)
USER node
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
LABEL org.opencontainers.image.source="https://github.com/frankjuchim/bts-liveticker-v2" \
      org.opencontainers.image.description="Turnier-Liveticker und Stream-Overlays für BTS" \
      org.opencontainers.image.licenses="MIT"
CMD ["node", "server.js"]
