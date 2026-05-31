# Video Generation API

API Node.js + FFmpeg para generar videos MP4 de tarjetas virtuales.

## Setup Rápido (Portainer)

### 1. Obtener Firebase Service Account

1. Ir a Firebase Console → Project Settings → Service Accounts
2. Click "Generate New Private Key"
3. Copiar el JSON completo

### 2. En Portainer

1. Abrir http://localhost:9000
2. Containers → Add Container
3. **Name**: `video-api`
4. **Build**: From Git repository
5. **Repository URL**: `https://github.com/tu-usuario/tu-repo.git`
6. **Repository ref**: `main`
7. **Build path**: `/video-api`
8. **Dockerfile**: `Dockerfile`
9. **Ports**: `3000:3000`
10. **Environment**:
    ```
    FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
    PORT=3000
    ```
11. Deploy

### 3. Verificar

```bash
curl http://localhost:3000/health
# Respuesta: {"status":"ok",...}
```

## API Endpoints

### POST /api/generate-video

**Request:**
```json
{
  "giftId": "tarjeta_123",
  "images": ["https://storage.googleapis.com/...", "..."],
  "videos": ["https://storage.googleapis.com/...", "..."],
  "message": "Papá te quiero",
  "title": "Regalo para Papá"
}
```

**Response:**
```json
{
  "success": true,
  "videoUrl": "https://storage.googleapis.com/...?expiration=...",
  "jobId": "uuid-xxx"
}
```

## Desarrollo Local

```bash
# Instalar dependencias
npm install

# Variables de entorno
cp .env.example .env
# Editar .env con FIREBASE_SERVICE_ACCOUNT

# Ejecutar
npm start

# Health check
curl http://localhost:3000/health
```

## Docker Local

```bash
# Build
docker build -t video-api .

# Run
docker run -p 3000:3000 \
  -e FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' \
  video-api

# Logs
docker logs video-api
```

## Troubleshooting

| Problema | Solución |
|---|---|
| "FFmpeg not found" | Verificar Dockerfile incluye apt-get install ffmpeg |
| "Firebase error" | Verificar FIREBASE_SERVICE_ACCOUNT JSON válido |
| "Video tarda >2min" | Normal si videos grandes o CPU baja |
| Container exits | Ver logs: `docker logs video-api` |

## Performance

- **Generación**: 30-60 segundos por video
- **Upload**: 5-10 segundos a Cloud Storage
- **CPU**: ~80-100% durante generación (normal)
- **RAM**: ~200-400MB

## Specs

- Node.js 20
- FFmpeg 4.4+
- Express.js 4.18
- Firebase Admin SDK 12.0
