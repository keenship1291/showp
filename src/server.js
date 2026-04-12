import fs from 'fs/promises';
import path from 'path';
import express from 'express';
import { config } from './config.js';
import { jobsRouter } from './routes/jobs.js';
import { resizeRouter } from './routes/resize.js';
import { healthRouter } from './routes/health.js';
import { startWorker } from './queue/worker.js';

const app = express();

// ── Middleware ─────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));

// CORS — allow Chrome extension to reach this server
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Static image serving ───────────────────────────────────────
app.use('/images', express.static(config.imagesDir, {
  maxAge: '7d',
  etag: true,
  lastModified: true,
}));

// ── Routes ─────────────────────────────────────────────────────
app.use('/api/jobs', jobsRouter);
app.use('/api/resize', resizeRouter);
app.use('/health', healthRouter);

// ── 404 ────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ──────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[server error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
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
