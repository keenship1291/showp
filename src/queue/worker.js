import { Worker } from 'bullmq';
import { createBullConnection } from '../storage/redis.js';
import { scrapeShopifyProduct, normalizePageProductData } from '../pipeline/scraper.js';
import { analyzeProductKnowledge, generateConceptsForBrand } from '../pipeline/analyzer.js';
import { generateImages } from '../pipeline/generator.js';
import { generateResizedVersions } from '../pipeline/resizer.js';
import { updateJob, appendImage } from '../storage/jobStore.js';
import { config } from '../config.js';

export async function startWorker() {
  const connection = createBullConnection();

  const worker = new Worker('pipeline', processJob, {
    connection,
    concurrency: 2,
  });

  worker.on('completed', job => {
    console.log(`[worker] Job ${job.id} completed`);
  });

  worker.on('failed', async (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message);
    if (job?.data?.jobId) {
      await updateJob(job.data.jobId, {
        status: 'failed',
        phase: 'failed',
        error: err.message,
      }).catch(() => {});
    }
  });

  console.log('[worker] Pipeline worker started (concurrency: 2)');
  return worker;
}

async function processJob(job) {
  // Route to the correct handler based on job type
  if (job.data.type === 'resize') {
    return processResizeJob(job);
  }
  return processPipelineJob(job);
}

// ── Resize job ─────────────────────────────────────────────────

async function processResizeJob(job) {
  const { jobId, imageUrl, formats, resolution } = job.data;

  await updateJob(jobId, { status: 'analyzing', phase: 'analyzing' });
  console.log(`[worker:${jobId}] Resize job: ${formats.join(',')} @ ${resolution}`);

  await updateJob(jobId, { status: 'generating', phase: 'generating', total: formats.length, current: 0 });

  await generateResizedVersions(imageUrl, formats, resolution, jobId, async ({ item, current, total }) => {
    await appendImage(jobId, {
      id: item.format.replace(':', 'x'),
      url: item.publicUrl,
      headline: item.label,
      angle_type: item.format,
      error: item.error || null,
    });
    await updateJob(jobId, { current, total });
    console.log(`[worker:${jobId}] Format ${item.format} ready (${current}/${total})`);
  });

  await updateJob(jobId, { status: 'done', phase: 'done' });
  console.log(`[worker:${jobId}] Resize complete`);
}

// ── Pipeline job ───────────────────────────────────────────────

async function processPipelineJob(job) {
  const {
    jobId, url, count, aspectRatio, resolution, outcome,
    pageProductData, userSelectedImageUrl,
  } = job.data;

  // ── Phase 1: Get product data ────────────────────────────────
  await updateJob(jobId, { status: 'scraping', phase: 'scraping' });

  let product = null;

  // Prefer browser-extracted data — no scraping, no blocks
  if (pageProductData && (pageProductData.title || pageProductData.name)) {
    product = normalizePageProductData(pageProductData, url);
    console.log(`[worker:${jobId}] Using page data: "${product.title}" (${product.images.length} images)`);

    // Enrich images from Shopify API when user hasn't provided their own image
    if (!userSelectedImageUrl) {
      try {
        const apiProduct = await scrapeShopifyProduct(url);
        if (apiProduct.top_image_urls?.length > 0) {
          product.images = apiProduct.images;
          product.top_image_urls = apiProduct.top_image_urls;
          product.image_count = apiProduct.image_count;
          console.log(`[worker:${jobId}] Image enrichment: ${product.top_image_urls.length} high-res images`);
        }
      } catch (e) {
        console.log(`[worker:${jobId}] Image enrichment failed (using extension images): ${e.message}`);
      }
    }
  } else {
    product = await scrapeShopifyProduct(url);
    console.log(`[worker:${jobId}] Scraped: "${product.title}" (${product.images.length} images)`);
  }

  // ── User image override (replaces auto-selected images) ──────
  // By the time we get here, userSelectedImageUrl is already a Kie CDN URL
  // (the route handler resolved base64 uploads before enqueueing).
  if (userSelectedImageUrl) {
    product.top_image_urls = [userSelectedImageUrl];
    product.images = [{ src: userSelectedImageUrl, width: 0, height: 0, alt: '' }];
    product.image_count = 1;
    console.log(`[worker:${jobId}] Using user image: ${userSelectedImageUrl}`);
  }

  // ── Phase 2: Product knowledge analysis ─────────────────────
  await updateJob(jobId, { status: 'analyzing', phase: 'analyzing', productTitle: product.title });
  console.log(`[worker:${jobId}] Analyzing product knowledge...`);

  const knowledge = await analyzeProductKnowledge(product, count);
  console.log(`[worker:${jobId}] Analysis: ${knowledge.core_usps?.length || 0} USPs, ${knowledge.ad_angle_ideas?.length || 0} angle ideas`);

  // ── Phase 3: Creative concept generation ────────────────────
  await updateJob(jobId, { status: 'concepts', phase: 'concepts' });
  console.log(`[worker:${jobId}] Generating ${count} creative concepts...`);

  const concepts = await generateConceptsForBrand(product, knowledge, count, aspectRatio, outcome);
  console.log(`[worker:${jobId}] Generated ${concepts.length} concepts (all ad_graphic)`);

  // ── Phase 4: Image generation ────────────────────────────────
  await updateJob(jobId, {
    status: 'generating',
    phase: 'generating',
    total: concepts.length,
    current: 0,
  });

  await generateImages(
    concepts,
    product,
    jobId,
    aspectRatio,
    resolution,
    async ({ image, current, total }) => {
      await appendImage(jobId, image);
      await updateJob(jobId, { current, total });
      console.log(`[worker:${jobId}] Image ready: ${image.id} (${current}/${total})`);
    },
  );

  // ── Done ─────────────────────────────────────────────────────
  await updateJob(jobId, { status: 'done', phase: 'done' });
  console.log(`[worker:${jobId}] Complete`);
}
