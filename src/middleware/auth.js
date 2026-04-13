import crypto from 'crypto';
import { config } from '../config.js';

/**
 * Validate the X-API-Key header using timing-safe comparison to prevent
 * timing attacks that could reveal the key length or content.
 */
export function validateApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const a = Buffer.from(key.padEnd(config.apiKey.length));
    const b = Buffer.from(config.apiKey);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
