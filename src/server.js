import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { jobsRouter } from './routes/jobs.js';
import { resizeRouter } from './routes/resize.js';
import { modifyRouter } from './routes/modify.js';
import { healthRouter } from './routes/health.js';
import { startWorker } from './queue/worker.js';

const app = express();

// ── Security headers ───────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ── Compression ────────────────────────────────────────────────
app.use(compression());

// ── Body parsing ───────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));

// ── CORS — Chrome extensions use null origin, so wildcard is required ──
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Rate limiting ──────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,       // 1 minute
  max: 60,                    // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

const jobCreateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,                    // max 10 new jobs per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Job creation limit reached. Please wait before submitting more jobs.' },
});

app.use('/api', apiLimiter);
app.use('/api/jobs', jobCreateLimiter);

// ── Static image serving ───────────────────────────────────────
app.use('/images', express.static(config.imagesDir, {
  maxAge: '7d',
  etag: true,
  lastModified: true,
}));

// ── Routes ─────────────────────────────────────────────────────
app.use('/api/jobs', jobsRouter);
app.use('/api/resize', resizeRouter);
app.use('/api/modify', modifyRouter);
app.use('/health', healthRouter);

// ── 404 ────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ──────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[server error]', err.message);
  // Never leak internal error details to clients in production
  const isProd = config.nodeEnv === 'production';
  res.status(err.status || 500).json({
    error: isProd ? 'Internal server error' : (err.message || 'Internal server error'),
  });
});

// ── Image cleanup — delete job folders older than 24 hours ─────
const IMAGE_TTL_MS = 24 * 60 * 60 * 1000;

async function cleanupOldImages() {
  try {
    const entries = await fs.readdir(config.imagesDir, { withFileTypes: true });
    const now = Date.now();
    let deleted = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(config.imagesDir, entry.name);
      const stat = await fs.stat(dirPath);
      if (now - stat.mtimeMs > IMAGE_TTL_MS) {
        await fs.rm(dirPath, { recursive: true, force: true });
        deleted++;
      }
    }
    if (deleted > 0) console.log(`[cleanup] Deleted ${deleted} image folder(s) older than 24h`);
  } catch (err) {
    console.error('[cleanup] Error during image cleanup:', err.message);
  }
}

// Run once on boot, then every hour
cleanupOldImages();
setInterval(cleanupOldImages, 60 * 60 * 1000);

// ── Boot ───────────────────────────────────────────────────────
await startWorker();

app.listen(config.port, () => {
  console.log(`[server] Ad Creative Server running on port ${config.port} (${config.nodeEnv})`);
  console.log(`[server] Images served from: ${config.imageBaseUrl}/images/`);
});
