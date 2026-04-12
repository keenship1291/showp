import express from 'express';
import { config } from './config.js';
import { jobsRouter } from './routes/jobs.js';
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
app.use('/health', healthRouter);

// ── 404 ────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ──────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[server error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Boot ───────────────────────────────────────────────────────
await startWorker();

app.listen(config.port, () => {
  console.log(`[server] Ad Creative Server running on port ${config.port} (${config.nodeEnv})`);
  console.log(`[server] Images served from: ${config.imageBaseUrl}/images/`);
});
