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

// ── Kie.ai File Upload API ──────────────────────────────────────

/**
 * Pre-upload a remote URL to Kie's CDN so Kie.ai can reliably fetch it as a reference image.
 * Returns the kieai.redpandaai.co fileUrl, or null on failure (non-fatal).
 */
async function uploadUrlToKie(fileUrl) {
  try {
    const res = await axios.post(
      `${config.kieAiUploadBaseUrl}/api/file-url-upload`,
      { fileUrl, uploadPath: 'ad-creative-refs' },
      {
        headers: {
          Authorization: `Bearer ${config.kieAiApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
    if (res.data?.code === 200 && res.data?.data?.fileUrl) {
      return res.data.data.fileUrl;
    }
    console.warn(`[generator] Kie URL upload returned unexpected response: ${JSON.stringify(res.data)}`);
    return null;
  } catch (err) {
    console.warn(`[generator] Kie URL upload failed for ${fileUrl}: ${err.message}`);
    return null;
  }
}

/**
 * Pre-upload a base64 image to Kie's CDN.
 * base64Data must be a full data URL: "data:image/jpeg;base64,..."
 * Returns the kieai.redpandaai.co fileUrl, or null on failure (non-fatal).
 */
export async function uploadBase64ToKie(base64Data, fileName = 'input.jpg') {
  try {
    const res = await axios.post(
      `${config.kieAiUploadBaseUrl}/api/file-base64-upload`,
      { base64Data, uploadPath: 'ad-creative-refs', fileName },
      {
        headers: {
          Authorization: `Bearer ${config.kieAiApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
    if (res.data?.code === 200 && res.data?.data?.fileUrl) {
      return res.data.data.fileUrl;
    }
    console.warn(`[generator] Kie base64 upload returned unexpected response: ${JSON.stringify(res.data)}`);
    return null;
  } catch (err) {
    console.warn(`[generator] Kie base64 upload failed: ${err.message}`);
    return null;
  }
}

/**
 * Pre-upload all reference image URLs to Kie's CDN and return the hosted URLs.
 * Falls back to original URLs for any that fail.
 */
async function preUploadImagesToKie(imageUrls) {
  const results = await Promise.all(
    imageUrls.map(async url => {
      const kieUrl = await uploadUrlToKie(url);
      return kieUrl || url; // fall back to original if upload fails
    }),
  );
  return results;
}

// ── Kie.ai API ─────────────────────────────────────────────────

async function createKieTask(prompt, aspectRatio, resolution, imageUrls) {
  const input = {
    prompt,
    aspect_ratio: aspectRatio,
    resolution,
    output_format: 'jpg',
  };

  // Pre-upload reference images to Kie's CDN so they're reliably accessible
  if (imageUrls.length > 0) {
    const hostedUrls = await preUploadImagesToKie(imageUrls);
    input.image_input = hostedUrls;
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
  // Prefer pre-computed top_image_urls — scraper already handles width=0 images correctly there
  const urls = productData.top_image_urls?.length
    ? productData.top_image_urls.slice(0, 5)
    : (productData.images || [])
        .filter(img => img.src && (img.width >= 400 || img.width === 0))
        .sort((a, b) => (b.width * b.height) - (a.width * a.height))
        .slice(0, 5)
        .map(img => img.src);

  // Normalize protocol-relative URLs (//cdn.shopify.com/...) — Kie.ai needs full https:// URLs
  return urls
    .map(url => (url && url.startsWith('//') ? `https:${url}` : url))
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
