import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

const FORMAT_LABELS = {
  '1:1':  'Feed Square',
  '4:5':  'Feed Portrait',
  '9:16': 'Stories & Reels',
  '16:9': 'Landscape Banner',
  '3:4':  'Vertical Portrait',
};

const COMPOSITION_NOTES = {
  '1:1':  'Center the main subject. Balance equal space on all sides.',
  '4:5':  'Keep subject prominent with slight vertical extension.',
  '9:16': 'Full vertical expansion. Stack elements top to bottom if needed.',
  '16:9': 'Extend background horizontally. Keep subject centered or center-left.',
  '3:4':  'Moderate vertical format. Compact and well-balanced composition.',
};

/**
 * Step 1: Use the LLM (Gemma 4 vision) to analyze the uploaded creative
 * and produce a Visual Identity Brief used to drive all resize prompts.
 */
export async function analyzeCreative(imageUrl) {
  const prompt = `You are an expert Meta advertising creative analyst.

Analyze this ad creative image and produce a concise Visual Identity Brief covering:
- Theme & style (mood, aesthetic)
- Color palette (2-4 dominant colors with hex codes if visible)
- Key visual elements and their positions (product, people, background, props)
- Typography: exact text content, font style, placement
- Brand elements: logos, branded colors, distinctive marks
- Background description
- Estimated source aspect ratio
- Design hierarchy / focal point

Return ONLY the brief as a single dense paragraph (no bullet points, no headers).
Example: "Dark-background luxury skincare product ad. Dominant colors: deep charcoal (#1a1a1a), gold accent (#c9a96e), white text. Centered glass serum bottle with golden dropper, subtle bokeh background. Headline PURE RADIANCE in serif gold font at top-center. Brand logo bottom-right. Soft rim lighting on product. Clean premium aesthetic. Source ratio appears 1:1."`;

  const res = await axios.post(
    `${config.llmBaseUrl}/chat/completions`,
    {
      model: config.llmModel,
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt },
        ],
      }],
    },
    {
      headers: {
        Authorization: `Bearer ${config.openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': config.imageBaseUrl || 'https://localhost',
        'X-Title': 'Ad Creative Resizer',
      },
      timeout: 60000,
    },
  );

  const text = res.data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('LLM returned empty visual brief');
  return text.trim();
}

/**
 * Step 2: For each selected format, generate a resize prompt and call Kie.ai.
 */
export async function generateResizedVersions(imageUrl, formats, resolution, jobId, onFormatReady) {
  const jobDir = path.join(config.imagesDir, jobId);
  await fs.mkdir(jobDir, { recursive: true });

  // Analyze the creative once, reuse the brief for all formats
  let visualBrief;
  try {
    visualBrief = await analyzeCreative(imageUrl);
    console.log(`[resizer:${jobId}] Visual brief: ${visualBrief.substring(0, 120)}...`);
  } catch (err) {
    console.warn(`[resizer:${jobId}] Visual analysis failed, using generic brief: ${err.message}`);
    visualBrief = 'Professional advertising creative with brand elements, typography, and product imagery.';
  }

  let completed = 0;
  const total = formats.length;

  // Run all formats in parallel (each is an independent Kie task)
  const results = await Promise.allSettled(
    formats.map(async (format) => {
      const prompt = buildResizePrompt(visualBrief, format);
      const taskId = await createKieResizeTask(prompt, format, resolution, imageUrl);
      const kieUrl = await pollKieTask(taskId);
      const safeFormat = format.replace(':', 'x');
      const filename = `${safeFormat}_${FORMAT_LABELS[format]?.replace(/\s+/g, '_') || safeFormat}.jpg`;
      await downloadAndSave(kieUrl, jobDir, filename);
      return {
        format,
        label: FORMAT_LABELS[format] || format,
        filename,
        publicUrl: `${config.imageBaseUrl}/images/${jobId}/${filename}`,
      };
    }),
  );

  for (let i = 0; i < formats.length; i++) {
    const result = results[i];
    const format = formats[i];
    completed++;

    if (result.status === 'fulfilled') {
      await onFormatReady({ item: result.value, current: completed, total });
    } else {
      console.error(`[resizer:${jobId}] Format ${format} failed: ${result.reason?.message}`);
      await onFormatReady({
        item: { format, label: FORMAT_LABELS[format] || format, publicUrl: null, error: result.reason?.message },
        current: completed,
        total,
      });
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────

function buildResizePrompt(visualBrief, format) {
  const label = FORMAT_LABELS[format] || format;
  const note = COMPOSITION_NOTES[format] || '';
  return `${visualBrief}

Recreate this advertisement in ${format} (${label}) format for Meta advertising.
PRESERVE exactly: the color palette, brand elements, typography style, product placement, and overall aesthetic.
ADAPT the composition to fit ${format} — extend the background naturally, reposition elements slightly if needed to fill the frame well.
Keep all text readable and all brand elements visible.
${note}
NO new elements, NO style changes, NO color changes.
Professional advertising quality, pixel-perfect brand consistency.`;
}

async function createKieResizeTask(prompt, aspectRatio, resolution, imageUrl) {
  const res = await axios.post(
    `${config.kieAiBaseUrl}/jobs/createTask`,
    {
      model: config.kieAiModel,
      input: {
        prompt,
        aspect_ratio: aspectRatio,
        resolution,
        output_format: 'jpg',
        image_input: [imageUrl],
      },
    },
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
      { params: { taskId }, headers: { Authorization: `Bearer ${config.kieAiApiKey}` }, timeout: 15000 },
    );
    const taskData = res.data?.data;
    const state = taskData?.state;
    if (state === 'success') {
      const result = JSON.parse(taskData.resultJson);
      const url = result.resultUrls?.[0];
      if (!url) throw new Error('Kie.ai returned empty resultUrls');
      return url;
    }
    if (state === 'fail') throw new Error(`Kie.ai generation failed: ${taskData.failMsg || 'unknown'}`);
  }
  throw new Error(`Resize timed out after ${config.pollTimeoutMs / 1000}s`);
}

async function downloadAndSave(imageUrl, jobDir, filename) {
  const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
  await fs.writeFile(path.join(jobDir, filename), res.data);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
