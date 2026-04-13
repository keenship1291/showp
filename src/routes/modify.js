import { Router } from 'express';
import { nanoid } from 'nanoid';
import { validateApiKey } from '../middleware/auth.js';
import { enqueueJob } from '../queue/jobQueue.js';
import { createJob, getJob } from '../storage/jobStore.js';

const router = Router();

const VALID_ASPECT_RATIOS = new Set(['1:1', '4:5', '9:16', '16:9', '3:4']);
const VALID_RESOLUTIONS   = new Set(['1K', '2K']);

// ── POST /api/modify ───────────────────────────────────────────
// Modify an existing generated image using a user prompt (img2img).
router.post('/', validateApiKey, async (req, res) => {
  const { imageUrl, modifyPrompt, aspectRatio, resolution } = req.body;

  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
    return res.status(400).json({ error: 'imageUrl must be a valid HTTP/HTTPS URL' });
  }
  if (!modifyPrompt || typeof modifyPrompt !== 'string' || !modifyPrompt.trim()) {
    return res.status(400).json({ error: 'modifyPrompt is required' });
  }
  if (modifyPrompt.trim().length > 1000) {
    return res.status(400).json({ error: 'modifyPrompt must be under 1000 characters' });
  }

  const safeAspectRatio = VALID_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : '1:1';
  const safeResolution  = VALID_RESOLUTIONS.has(resolution) ? resolution : '1K';
  const jobId = nanoid(16);

  await createJob(jobId, { imageUrl, modifyPrompt: modifyPrompt.trim(), aspectRatio: safeAspectRatio, resolution: safeResolution });

  await enqueueJob(jobId, {
    jobId,
    type: 'modify',
    imageUrl,
    modifyPrompt: modifyPrompt.trim(),
    aspectRatio: safeAspectRatio,
    resolution: safeResolution,
  });

  console.log(`[modify] Created job ${jobId}: ${safeAspectRatio} @ ${safeResolution}`);
  return res.status(201).json({ jobId, status: 'pending' });
});

// ── GET /api/modify/:id ────────────────────────────────────────
router.get('/:id', validateApiKey, async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found (may have expired)' });
  return res.json({
    jobId: req.params.id,
    status: job.status,
    phase: job.phase,
    images: job.images || [],
    error: job.error || null,
  });
});

export { router as modifyRouter };
