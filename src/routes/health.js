import { Router } from 'express';
import { getAppRedis } from '../storage/redis.js';
import { config } from '../config.js';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const redis = getAppRedis();
    await redis.ping();
    res.json({ status: 'ok', redis: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', redis: 'disconnected', error: err.message });
  }
});

// Debug: list all saved images on disk
router.get('/images', async (_req, res) => {
  try {
    const jobs = await fs.readdir(config.imagesDir).catch(() => []);
    const result = {};
    for (const jobId of jobs) {
      const files = await fs.readdir(path.join(config.imagesDir, jobId)).catch(() => []);
      result[jobId] = files.map(f => `${config.imageBaseUrl}/images/${jobId}/${f}`);
    }
    res.json({ imageBaseUrl: config.imageBaseUrl, imagesDir: config.imagesDir, jobs: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router as healthRouter };
