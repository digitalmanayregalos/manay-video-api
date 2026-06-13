import express from 'express';
import axios from 'axios';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Firebase Admin Init
let firebaseInitialized = false;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  firebaseInitialized = true;
  console.log('✅ Firebase initialized');
} catch (error) {
  console.warn('⚠️ Firebase not initialized:', error.message);
  console.log('Health check will work, but video upload will fail');
}

const db = firebaseInitialized ? admin.firestore() : null;
const bucket = firebaseInitialized ? admin.storage().bucket('maia---manay-regalos.firebasestorage.app') : null;

const ALERT_RECIPIENTS = ['juanceronb@gmail.com', 'dianar.daza@gmail.com'];

// Helper: Enviar alerta por email en caso de error
async function sendErrorAlert(functionality, component, reason, stackTrace) {
  try {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;

    console.log('📧 Verificando SMTP config:', { host: !!smtpHost, user: !!smtpUser, pass: !!smtpPassword });

    if (!smtpHost || !smtpUser || !smtpPassword) {
      console.warn('⚠️ SMTP no está configurado - no se enviarán alertas por email');
      console.warn('Variables disponibles:', Object.keys(process.env).filter(k => k.includes('SMTP')));
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort || '995'),
      secure: true, // SSL
      auth: {
        user: smtpUser,
        pass: smtpPassword
      },
      connectionTimeout: 10000,
      socketTimeout: 10000
    });

    const emailBody = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌⚠️🚨 ALERTA DE ERROR DEL SISTEMA

📌 Funcionalidad Afectada:
${functionality}

🔧 Componente Tecnológico:
${component}

❌ Razón de la Falla:
${reason}

📋 Stack Trace:
${stackTrace}

⏰ Timestamp: ${new Date().toISOString()}
🌍 Proyecto: Tarjeta Virtual Día del Padre
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `;

    const mailOptions = {
      from: smtpUser,
      to: ALERT_RECIPIENTS.join(', '),
      subject: '❌⚠️🚨 ERROR: Creación de Tarjeta Virtual',
      text: emailBody,
      html: emailBody.replace(/\n/g, '<br>')
    };

    await transporter.sendMail(mailOptions);
    console.log('✉️ Alerta de error enviada a:', ALERT_RECIPIENTS);
  } catch (emailError) {
    console.error('❌ Error enviando alerta por email:', emailError.message);
  }
}

// Helper: Enviar correo de notificación (éxito)
async function sendNotificationEmail(subject, message, details = {}) {
  try {
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;

    if (!smtpHost || !smtpUser || !smtpPassword) {
      console.warn('SMTP no está configurado');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort || '995'),
      secure: true,
      auth: { user: smtpUser, pass: smtpPassword },
      connectionTimeout: 10000,
      socketTimeout: 10000
    });

    const emailBody = `
${message}

${Object.entries(details).map(([key, value]) => `${key}: ${value}`).join('\n')}

⏰ Timestamp: ${new Date().toISOString()}
    `;

    const mailOptions = {
      from: smtpUser,
      to: ALERT_RECIPIENTS.join(', '),
      subject: subject,
      text: emailBody,
      html: emailBody.replace(/\n/g, '<br>')
    };

    await transporter.sendMail(mailOptions);
    console.log('✉️ Notificación enviada:', subject);
  } catch (emailError) {
    console.error('❌ Error enviando notificación:', emailError.message);
  }
}

// Temporales
const TEMP_DIR = '/tmp/video-generation';
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    ffmpeg: 'ready',
    firebase: firebaseInitialized ? 'connected' : 'not-configured'
  });
});

// Endpoint: Generar Video
app.post('/api/generate-video', async (req, res) => {
  try {
    const { images = [], videos = [], message, title, giftId } = req.body;

    if (!giftId) {
      return res.status(400).json({ error: 'giftId es requerido' });
    }

    if (!firebaseInitialized) {
      return res.status(503).json({ error: 'Firebase no está configurado' });
    }

    const jobId = uuidv4();
    console.log(`[${jobId}] Iniciando generación para regalo: ${giftId}`);

    // Crear directorio de trabajo
    const workDir = path.join(TEMP_DIR, jobId);
    fs.mkdirSync(workDir, { recursive: true });

    try {
      // Descargar archivos de Cloud Storage
      console.log(`[${jobId}] Descargando media...`);
      const mediaFiles = await downloadMedia(images, videos, workDir);

      if (mediaFiles.length === 0) {
        return res.status(400).json({ error: 'No media files provided' });
      }

      // Generar video
      console.log(`[${jobId}] Generando video con FFmpeg...`);
      const videoPath = await generateVideo(mediaFiles, message, title, workDir, jobId);

      // Subir a Cloud Storage
      console.log(`[${jobId}] Subiendo a Cloud Storage...`);
      const videoUrl = await uploadToCloudStorage(videoPath, giftId, jobId);

      // Actualizar Firestore
      console.log(`[${jobId}] Actualizando Firestore...`);
      await db.collection('regalos').doc(giftId).update({
        videoUrl: videoUrl,
        videoGeneratedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`[${jobId}] ✅ Video generado: ${videoUrl}`);

      // Enviar notificación de éxito
      await sendNotificationEmail(
        '✅ VIDEO GENERADO: Tarjeta Virtual Lista',
        '✅ El video de la tarjeta virtual ha sido generado exitosamente',
        {
          'Gift ID': giftId,
          'Job ID': jobId,
          'Video URL': videoUrl,
          'Timestamp': new Date().toISOString()
        }
      );

      // Limpiar temporales
      fs.rmSync(workDir, { recursive: true });

      res.json({
        success: true,
        videoUrl: videoUrl,
        jobId: jobId
      });

    } catch (error) {
      console.error(`[${jobId}] Error en generación:`, error);

      // Marcar como fallido en Firestore
      try {
        await db.collection('regalos').doc(giftId).update({
          videoUrl: 'failed',
          videoError: error.message,
          videoErrorAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (updateError) {
        console.error(`[${jobId}] Error updating Firestore:`, updateError);
      }

      // Limpiar
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }

      throw error;
    }
  } catch (error) {
    console.error('API Error:', error);

    // Enviar alerta por email
    await sendErrorAlert(
      'Generación de video MP4 con FFmpeg',
      'Video Generation API Server',
      error.message,
      error.stack || 'No stack trace disponible'
    );

    res.status(500).json({
      error: error.message || 'Error generando video'
    });
  }
});

// Helper: Normalizar imagen con FFmpeg
async function normalizeImage(inputPath, outputPath, jobId) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-vf', 'format=yuv420p',
      '-q:v', '2',
      outputPath
    ]);

    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg.includes('error') || msg.includes('Error')) {
        console.warn(`[${jobId}] FFmpeg normalize warning:`, msg.slice(0, 100));
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error(`Failed to normalize image: exit code ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}

// Helper: Descargar media de URLs
async function downloadMedia(images = [], videos = [], workDir) {
  const files = [];

  // Procesar imágenes
  for (let i = 0; i < images.length; i++) {
    try {
      const tempPath = path.join(workDir, `image_${i}_temp.jpg`);
      const normalizedPath = path.join(workDir, `image_${i}.jpg`);

      const response = await axios.get(images[i], { responseType: 'stream', timeout: 30000 });
      const stream = fs.createWriteStream(tempPath);
      response.data.pipe(stream);

      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });

      // Normalizar imagen
      await normalizeImage(tempPath, normalizedPath, `image-${i}`);
      fs.unlinkSync(tempPath); // Eliminar temporal

      files.push({ type: 'image', path: normalizedPath });
      console.log(`✅ Descargada y normalizada imagen ${i}`);
    } catch (err) {
      console.warn(`⚠️ Error procesando imagen ${i}:`, err.message);
    }
  }

  // Procesar videos
  for (let i = 0; i < videos.length; i++) {
    try {
      const videoPath = path.join(workDir, `video_${i}.mp4`);
      const response = await axios.get(videos[i], { responseType: 'stream', timeout: 60000 });
      const stream = fs.createWriteStream(videoPath);
      response.data.pipe(stream);

      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });

      files.push({ type: 'video', path: videoPath });
      console.log(`✅ Descargado video ${i}`);
    } catch (err) {
      console.warn(`⚠️ Error descargando video ${i}:`, err.message);
    }
  }

  return files;
}

// Helper: Generar video con FFmpeg
async function generateVideo(mediaFiles, message, title, workDir, jobId) {
  const outputPath = path.join(workDir, 'output.mp4');

  // Duración por archivo
  const durPerFile = 5; // segundos

  // Construir filtro FFmpeg - versión mejorada con formato normalizado
  let filterComplex = '';

  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    if (file.type === 'image') {
      // Imagen: asegurar conversión correcta a yuv420p
      filterComplex += `[${i}]format=yuv420p,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1:1,fade=t=in:st=0:d=0.5,fade=t=out:st=${durPerFile - 0.5}:d=0.5[v${i}];`;
    } else {
      // Video: asegurar formato compatible
      filterComplex += `[${i}]format=yuv420p,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1:1[v${i}];`;
    }
  }

  // Concatenar: importante especificar a=0 para ignorar audio
  filterComplex += `${mediaFiles.map((_, i) => `[v${i}]`).join('')}concat=n=${mediaFiles.length}:v=1:a=0[out]`;

  // Argumentos FFmpeg
  const ffmpegArgs = ['-y']; // Overwrite output

  // Inputs
  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    if (file.type === 'image') {
      ffmpegArgs.push('-loop', '1', '-t', String(durPerFile), '-i', file.path);
    } else {
      ffmpegArgs.push('-i', file.path);
    }
  }

  // Filtro y codec
  ffmpegArgs.push('-filter_complex', filterComplex);
  ffmpegArgs.push('-map', '[out]');
  ffmpegArgs.push('-c:v', 'libx264', '-crf', '23', '-preset', 'medium');
  ffmpegArgs.push('-pix_fmt', 'yuv420p');
  ffmpegArgs.push('-r', '30');
  ffmpegArgs.push('-movflags', '+faststart');
  ffmpegArgs.push(outputPath);

  console.log(`[${jobId}] FFmpeg filter: ${filterComplex.slice(0, 200)}...`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);

    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg.includes('error') || msg.includes('Error')) {
        console.error(`[${jobId}] FFmpeg Error:`, msg.slice(0, 200));
      } else if (msg.includes('frame=')) {
        // Progress
        console.log(`[${jobId}] ${msg.slice(0, 100)}`);
      }
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}`));
      } else {
        if (fs.existsSync(outputPath)) {
          const size = fs.statSync(outputPath).size;
          console.log(`[${jobId}] ✅ FFmpeg generó video exitosamente (${(size / 1024 / 1024).toFixed(2)} MB)`);
          resolve(outputPath);
        } else {
          reject(new Error('FFmpeg no generó el archivo de output'));
        }
      }
    });

    ffmpeg.on('error', (err) => {
      console.error(`[${jobId}] FFmpeg spawn error:`, err);
      reject(err);
    });
  });
}

// Helper: Subir a Cloud Storage
async function uploadToCloudStorage(localPath, giftId, jobId) {
  const fileName = `${Date.now()}_video.mp4`;
  const remotePath = `regalos/${giftId}/${fileName}`;

  try {
    console.log(`[${jobId}] Subiendo a: ${remotePath}`);
    await bucket.upload(localPath, {
      destination: remotePath,
      metadata: {
        metadata: {
          jobId: jobId,
          generatedAt: new Date().toISOString()
        }
      }
    });

    const file = bucket.file(remotePath);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7 // 7 días máximo
    });

    console.log(`[${jobId}] ✅ URL generada`);
    return url;
  } catch (error) {
    console.error(`[${jobId}] Error subiendo a Cloud Storage:`, error);
    throw error;
  }
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🎬 Video API iniciada en puerto ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Endpoint: POST http://localhost:${PORT}/api/generate-video`);
  console.log(`Firebase: ${firebaseInitialized ? '✅ Conectado' : '❌ No configurado'}`);
});

export default app;
