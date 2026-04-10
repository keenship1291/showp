import { config } from '../config.js';

/**
 * Validate the X-API-Key header against the server's configured API key.
 * All /api/* routes require this.
 */
export function validateApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.apiKey) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-API-Key header' });
  }
  next();
}
