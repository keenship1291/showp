import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { validateApiKey } from '../middleware/auth.js';
import { enqueueJob } from '../queue/jobQueue.js';
import { createJob, getJob } from '../storage/jobStore.js';
import { config } from '../config.js';

const router = Router();

const VALID_ASPECT_RATIOS = new Set(['1:1', '4:5', '9:16', '16:9']);
const VALID_RESOLUTIONS   = new Set(['1K', '2K', '4K']);
const MAX_COUNT           = 50;
const MAX_BASE64_BYTES    = 10 * 1024 * 1024; // 10 MB decoded limit

// ── POST /api/jobs ─────────────────────────────────────────────
// Start a new ad creative generation job.
router.post('/', validateApiKey, async (req, res) => {
  const { url, count, aspectRatio, resolution, outcome, pageProductData, userSelectedImageUrl, userImageBase64, userImageMimeType } = req.body;

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'url must be a valid HTTP/HTTPS URL' });
  }

  if (!isShopifyProductUrl(url)) {
    return res.status(400).json({ error: 'url must be a Shopify product page (.../products/...)' });
  }

  const parsedCount = parseInt(count, 10);
  if (isNaN(parsedCount) || parsedCount < 1 || parsedCount > MAX_COUNT) {
    return res.status(400).json({ error: `count must be between 1 and ${MAX_COUNT}` });
  }
  const safeCount = parsedCount;
  const safeAspectRatio = VALID_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : '1:1';
  const safeResolution = VALID_RESOLUTIONS.has(resolution) ? resolution : '1K';
  const VALID_OUTCOMES = new Set(['highlight_benefits','build_trust','crush_competitors','show_results','drive_sales','stop_scroll']);
  const safeOutcome = VALID_OUTCOMES.has(outcome) ? outcome : 'highlight_benefits';

  const jobId = nanoid(16);

  // If user uploaded a base64 image, save it to the VPS filesystem immediately
  // and pass the resulting public URL into the queue.
  // This keeps base64 out of Redis/BullMQ and gives Kie.ai a stable public URL to fetch.
  let resolvedImageUrl = null;

  // Download externally-hosted images (e.g. Shopify CDN) to the VPS so Kie.ai
  // can fetch them — Shopify CDN blocks direct server-to-server requests without
  // browser headers, but our VPS can proxy the download and serve from IMAGE_BASE_URL.
  if (userSelectedImageUrl) {
    try {
      const jobDir = path.join(config.imagesDir, jobId);
      await fs.mkdir(jobDir, { recursive: true });
      const imgRes = await axios.get(userSelectedImageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': new URL(userSelectedImageUrl).origin + '/',
          'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });
      // Detect extension from URL or Content-Type header
      const contentType = imgRes.headers['content-type'] || '';
      const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
      const ext = extMap[contentType.split(';')[0].trim()] || path.extname(new URL(userSelectedImageUrl).pathname).slice(1) || 'jpg';
      const filePath = path.join(jobDir, `input.${ext}`);
      await fs.writeFile(filePath, imgRes.data);
      resolvedImageUrl = `${config.imageBaseUrl}/images/${jobId}/input.${ext}`;
      console.log(`[jobs] User selected image proxied → ${resolvedImageUrl}`);
    } catch (err) {
      console.error(`[jobs] Failed to proxy user image for job ${jobId}: ${err.message}`);
      // Fall back to the raw URL — Kie.ai may still be able to fetch it
      resolvedImageUrl = userSelectedImageUrl;
    }
  }

  if (!resolvedImageUrl && userImageBase64) {
    // Reject oversized uploads before hitting the filesystem
    const decodedBytes = Math.floor(userImageBase64.length * 0.75);
    if (decodedBytes > MAX_BASE64_BYTES) {
      return res.status(400).json({ error: 'Image too large. Maximum size is 10 MB.' });
    }
    try {
      const ALLOWED_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
      const mimeType = userImageMimeType || 'image/jpeg';
      const ext = ALLOWED_MIME[mimeType] || 'jpg';
      const jobDir = path.join(config.imagesDir, jobId);
      await fs.mkdir(jobDir, { recursive: true });
      const filePath = path.join(jobDir, `input.${ext}`);
      await fs.writeFile(filePath, Buffer.from(userImageBase64, 'base64'));
      resolvedImageUrl = `${config.imageBaseUrl}/images/${jobId}/input.${ext}`;
      console.log(`[jobs] User image saved → ${resolvedImageUrl}`);
    } catch (err) {
      console.error(`[jobs] Failed to save user image for job ${jobId}: ${err.message}`);
      // Proceed without the image rather than blocking the job
    }
  }

  await createJob(jobId, {
    url,
    count: safeCount,
    aspectRatio: safeAspectRatio,
    resolution: safeResolution,
  });

  await enqueueJob(jobId, {
    jobId,
    url,
    count: safeCount,
    aspectRatio: safeAspectRatio,
    resolution: safeResolution,
    outcome: safeOutcome,
    pageProductData: pageProductData || null,
    userSelectedImageUrl: resolvedImageUrl,
  });

  console.log(`[jobs] Created job ${jobId}: ${url} (count: ${safeCount}, userImage: ${resolvedImageUrl ? 'yes' : 'no'})`);
  return res.status(201).json({ jobId, status: 'pending' });
});

// ── GET /api/jobs/:id ──────────────────────────────────────────
// Poll job status and get generated images.
router.get('/:id', validateApiKey, async (req, res) => {
  const job = await getJob(req.params.id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found (may have expired)' });
  }

  return res.json({
    jobId: req.params.id,
    status: job.status,
    phase: job.phase,
    productTitle: job.productTitle || null,
    current: job.current || 0,
    total: job.total || job.count || 0,
    images: job.images || [],
    error: job.error || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

// ── Helpers ────────────────────────────────────────────────────

function isShopifyProductUrl(url) {
  try {
    return new URL(url).pathname.includes('/products/');
  } catch (_) {
    return false;
  }
}

export { router as jobsRouter };
