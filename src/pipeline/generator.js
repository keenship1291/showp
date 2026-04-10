import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

/**
 * Generate images for all concepts.
 * Processes in batches of `concurrentGenerations` to avoid hammering Kie.ai.
 *
 * @param {object[]} concepts
 * @param {object} productData
 * @param {string} jobId
 * @param {string} aspectRatio  e.g. '1:1'
 * @param {string} resolution   e.g. '1K'
 * @param {Function} onImageReady  called after each image: ({ image, current, total })
 */
export async function generateImages(concepts, productData, jobId, aspectRatio, resolution, onImageReady) {
  const concurrency = config.concurrentGenerations;
  const productImageUrls = getTopProductImages(productData);
  let completed = 0;

  // Ensure output directory exists
  const jobDir = path.join(config.imagesDir, jobId);
  await fs.mkdir(jobDir, { recursive: true });

  for (let i = 0; i < concepts.length; i += concurrency) {
    const batch = concepts.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(concept =>
        generateOneImage(concept, jobId, jobDir, aspectRatio, resolution, productImageUrls),
      ),
    );

    for (let j = 0; j < batch.length; j++) {
      const concept = batch[j];
      const result = results[j];
      completed++;

      if (result.status === 'fulfilled') {
        await onImageReady({
          image: {
            id: concept.id,
            url: result.value.publicUrl,
            headline: concept.headline,
            angle_type: concept.angle_type,
          },
          current: completed,
          total: concepts.length,
        });
      } else {
        console.error(`[generator] ${concept.id} failed: ${result.reason?.message}`);
        // Report failure but keep going — don't let one bad image kill the job
        await onImageReady({
          image: {
            id: concept.id,
            url: null,
            headline: concept.headline,
            angle_type: concept.angle_type,
            error: result.reason?.message || 'Generation failed',
          },
          current: completed,
          total: concepts.length,
        });
      }
    }
  }
}

// ── Per-image pipeline ─────────────────────────────────────────

async function generateOneImage(concept, jobId, jobDir, aspectRatio, resolution, productImageUrls) {
  const taskId = await createKieTask(concept.image_prompt, aspectRatio, resolution, productImageUrls);
  const kieUrl = await pollKieTask(taskId);
  await downloadAndSave(kieUrl, jobDir, concept.id);

  return {
    publicUrl: `${config.imageBaseUrl}/images/${jobId}/${concept.id}.jpg`,
  };
}

// ── Kie.ai API ─────────────────────────────────────────────────

async function createKieTask(prompt, aspectRatio, resolution, imageUrls) {
  const input = {
    prompt,
    aspect_ratio: aspectRatio,
    resolution,
    output_format: 'jpg',
  };

  // Pass product images as reference — this is the main driver of brand/product accuracy
  if (imageUrls.length > 0) {
    input.image_input = imageUrls;
  }

  const res = await axios.post(
    `${config.kieAiBaseUrl}/jobs/createTask`,
    { model: config.kieAiModel, input },
    {
      headers: {
        Authorization: `Bearer ${config.kieAiApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    },
  );

  if (res.data.code !== 200) {
    throw new Error(`Kie.ai task creation failed (code ${res.data.code}): ${res.data.msg}`);
  }

  return res.data.data.taskId;
}

async function pollKieTask(taskId) {
  const deadline = Date.now() + config.pollTimeoutMs;

  while (Date.now() < deadline) {
    await sleep(config.pollIntervalMs);

    const res = await axios.get(
      `${config.kieAiBaseUrl}/jobs/recordInfo`,
      {
        params: { taskId },
        headers: { Authorization: `Bearer ${config.kieAiApiKey}` },
        timeout: 15000,
      },
    );

    const taskData = res.data?.data;
    const state = taskData?.state;

    if (state === 'success') {
      let result;
      try {
        result = JSON.parse(taskData.resultJson);
      } catch (_) {
        throw new Error('Kie.ai returned malformed resultJson');
      }
      const url = result.resultUrls?.[0];
      if (!url) throw new Error('Kie.ai returned empty resultUrls');
      return url;
    }

    if (state === 'fail') {
      const reason = taskData.failMsg || taskData.failCode || 'unknown';
      throw new Error(`Kie.ai generation failed: ${reason}`);
    }

    // state === 'pending' | 'running' — keep polling
  }

  throw new Error(`Image generation timed out after ${config.pollTimeoutMs / 1000}s`);
}

// ── Storage ────────────────────────────────────────────────────

async function downloadAndSave(imageUrl, jobDir, conceptId) {
  const res = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 60000,
  });

  const filePath = path.join(jobDir, `${conceptId}.jpg`);
  await fs.writeFile(filePath, res.data);
  return filePath;
}

// ── Utilities ──────────────────────────────────────────────────

function getTopProductImages(productData) {
  return productData.images
    .filter(img => img.src && img.width >= 400)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))
    .slice(0, 5)
    .map(img => img.src);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
