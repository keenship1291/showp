import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { validateApiKey } from '../middleware/auth.js';
import { enqueueJob } from '../queue/jobQueue.js';
import { createJob, getJob } from '../storage/jobStore.js';
import { config } from '../config.js';

const router = Router();

const VALID_ASPECT_RATIOS = new Set(['1:1', '4:5', '9:16', '16:9']);
const VALID_RESOLUTIONS = new Set(['1K', '2K', '4K']);
const MAX_COUNT = 50;

// ── POST /api/jobs ─────────────────────────────────────────────
// Start a new ad creative generation job.
router.post('/', validateApiKey, async (req, res) => {
  const { url, count, aspectRatio, resolution, pageProductData, userSelectedImageUrl, userImageBase64, userImageMimeType } = req.body;

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'url must be a valid HTTP/HTTPS URL' });
  }

  if (!isShopifyProductUrl(url)) {
    return res.status(400).json({ error: 'url must be a Shopify product page (.../products/...)' });
  }

  const safeCount = Math.min(Math.max(1, parseInt(count, 10) || 5), MAX_COUNT);
  const safeAspectRatio = VALID_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : '1:1';
  const safeResolution = VALID_RESOLUTIONS.has(resolution) ? resolution : '1K';

  const jobId = nanoid(16);

  // If user uploaded a base64 image, save it to the VPS filesystem immediately
  // and pass the resulting public URL into the queue.
  // This keeps base64 out of Redis/BullMQ and gives Kie.ai a stable public URL to fetch.
  let resolvedImageUrl = userSelectedImageUrl || null;
  if (!resolvedImageUrl && userImageBase64) {
    try {
      const mimeType = userImageMimeType || 'image/jpeg';
      const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'jpg';
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
