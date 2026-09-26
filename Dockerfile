# Leash backend: serves the landing page, the dashboard and the API. Node 22 (built-in SQLite).
FROM node:22-bookworm-slim
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend ./backend
COPY frontend ./frontend
COPY deployments ./deployments
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/leash.db
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/src/server.js"]
