import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { validateApiKey } from '../middleware/auth.js';
import { enqueueJob } from '../queue/jobQueue.js';
import { createJob, getJob } from '../storage/jobStore.js';
import { config } from '../config.js';

const router = Router();

const VALID_FORMATS = new Set(['1:1', '4:5', '9:16', '16:9', '3:4']);
const VALID_RESOLUTIONS = new Set(['1K', '2K']);

// ── POST /api/resize ───────────────────────────────────────────
// Start a resize job: take one uploaded creative, output it in multiple formats.
router.post('/', validateApiKey, async (req, res) => {
  const { userImageBase64, userImageMimeType, formats, resolution } = req.body;

  if (!userImageBase64) {
    return res.status(400).json({ error: 'userImageBase64 is required' });
  }

  const rawFormats = Array.isArray(formats) ? formats : (formats || '').split(',').map(f => f.trim());
  const safeFormats = rawFormats.filter(f => VALID_FORMATS.has(f));
  if (!safeFormats.length) {
    return res.status(400).json({ error: 'At least one valid format required (1:1, 4:5, 9:16, 16:9, 3:4)' });
  }

  const safeResolution = VALID_RESOLUTIONS.has(resolution) ? resolution : '1K';
  const jobId = nanoid(16);

  // Save uploaded image to VPS filesystem immediately
  let imageUrl;
  try {
    const mimeType = userImageMimeType || 'image/jpeg';
    const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'jpg';
    const jobDir = path.join(config.imagesDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });
    const filePath = path.join(jobDir, `source.${ext}`);
    await fs.writeFile(filePath, Buffer.from(userImageBase64, 'base64'));
    imageUrl = `${config.imageBaseUrl}/images/${jobId}/source.${ext}`;
    console.log(`[resize] Source image saved → ${imageUrl}`);
  } catch (err) {
    console.error(`[resize] Failed to save image: ${err.message}`);
    return res.status(500).json({ error: 'Failed to save uploaded image' });
  }

  await createJob(jobId, { formats: safeFormats, resolution: safeResolution });

  await enqueueJob(jobId, {
    jobId,
    type: 'resize',
    imageUrl,
    formats: safeFormats,
    resolution: safeResolution,
  });

  console.log(`[resize] Created job ${jobId}: ${safeFormats.join(',')} @ ${safeResolution}`);
  return res.status(201).json({ jobId, status: 'pending' });
});

export { router as resizeRouter };
