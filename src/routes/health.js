import { Router } from 'express';
import { getAppRedis } from '../storage/redis.js';

const router = Router();

// Public health check — only confirms the server and Redis are up
router.get('/', async (_req, res) => {
  try {
    const redis = getAppRedis();
    await redis.ping();
    res.json({ status: 'ok', redis: 'connected', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', redis: 'disconnected' });
  }
});

export { router as healthRouter };
