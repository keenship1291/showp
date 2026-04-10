import { Router } from 'express';
import { getAppRedis } from '../storage/redis.js';

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

export { router as healthRouter };
