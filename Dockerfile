FROM node:20-slim

# Instalar FFmpeg y dependencias
RUN apt-get update && apt-get install -y \
    ffmpeg \
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json
COPY package.json package-lock.json ./

# Instalar dependencias Node
RUN npm install --production

# Copiar código
COPY server.js ./

# Exponer puerto
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Ejecutar
CMD ["node", "server.js"]
