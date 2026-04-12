import { Router } from 'express';
import { nanoid } from 'nanoid';
import { validateApiKey } from '../middleware/auth.js';
import { enqueueJob } from '../queue/jobQueue.js';
import { createJob, getJob } from '../storage/jobStore.js';
import { uploadBase64ToKie } from '../pipeline/generator.js';

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

  // If user uploaded a base64 image, upload it to Kie CDN right now — before
  // the job enters the queue. This keeps the massive base64 string out of
  // Redis/BullMQ and means only a small CDN URL travels through the pipeline.
  let resolvedImageUrl = userSelectedImageUrl || null;
  if (!resolvedImageUrl && userImageBase64) {
    const mimeType = userImageMimeType || 'image/jpeg';
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'jpg';
    const base64DataUrl = `data:${mimeType};base64,${userImageBase64}`;
    console.log(`[jobs] Uploading user image to Kie CDN for job ${jobId}...`);
    resolvedImageUrl = await uploadBase64ToKie(base64DataUrl, `input-${jobId}.${ext}`);
    if (resolvedImageUrl) {
      console.log(`[jobs] User image uploaded to Kie CDN: ${resolvedImageUrl}`);
    } else {
      console.warn(`[jobs] Kie CDN upload failed for job ${jobId} — will proceed without user image`);
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
    // Only pass the resolved CDN URL — never put base64 in the queue
    userSelectedImageUrl: resolvedImageUrl,
  });

  console.log(`[jobs] Created job ${jobId}: ${url} (count: ${safeCount})`);
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
