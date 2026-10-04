# syntax=docker/dockerfile:1
#
# Dois estágios: o primeiro instala as dependências de produção; o segundo copia só o necessário.
# A imagem final roda sem root, sem ferramentas de build e com health check embutido.

FROM node:22-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
# 3000: tráfego da aplicação · 9100: métricas (interna, nunca publicada)
EXPOSE 3000 9100
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/saude').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/index.js"]
