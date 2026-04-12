import fs from 'fs/promises';
import path from 'path';
import { Worker } from 'bullmq';
import { createBullConnection } from '../storage/redis.js';
import { scrapeShopifyProduct, normalizePageProductData } from '../pipeline/scraper.js';
import { analyzeProductKnowledge, generateConceptsForBrand } from '../pipeline/analyzer.js';
import { generateImages, uploadBase64ToKie } from '../pipeline/generator.js';
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
  const {
    jobId, url, count, aspectRatio, resolution,
    pageProductData, userSelectedImageUrl, userImageBase64, userImageMimeType,
  } = job.data;

  // ── Phase 1: Get product data ────────────────────────────────
  await updateJob(jobId, { status: 'scraping', phase: 'scraping' });

  let product = null;

  // Prefer browser-extracted data — no scraping, no blocks
  if (pageProductData && (pageProductData.title || pageProductData.name)) {
    product = normalizePageProductData(pageProductData, url);
    console.log(`[worker:${jobId}] Using page data: "${product.title}" (${product.images.length} images)`);

    // Enrich images from Shopify API when user hasn't provided their own image
    if (!userSelectedImageUrl && !userImageBase64) {
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
  if (userSelectedImageUrl) {
    product.top_image_urls = [userSelectedImageUrl];
    product.images = [{ src: userSelectedImageUrl, width: 0, height: 0, alt: '' }];
    product.image_count = 1;
    console.log(`[worker:${jobId}] User-selected image: ${userSelectedImageUrl}`);
  } else if (userImageBase64) {
    const mimeType = userImageMimeType || 'image/jpeg';
    const ext = mimeType.split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'jpg';
    const base64DataUrl = `data:${mimeType};base64,${userImageBase64}`;
    const kieUrl = await uploadBase64ToKie(base64DataUrl, `input-${jobId}.${ext}`);
    if (kieUrl) {
      product.top_image_urls = [kieUrl];
      product.images = [{ src: kieUrl, width: 0, height: 0, alt: '' }];
      product.image_count = 1;
      console.log(`[worker:${jobId}] User-uploaded image hosted on Kie CDN: ${kieUrl}`);
    } else {
      // Fallback: save locally and use self-hosted URL
      const jobDir = path.join(config.imagesDir, jobId);
      await fs.mkdir(jobDir, { recursive: true });
      const inputPath = path.join(jobDir, `input.${ext}`);
      await fs.writeFile(inputPath, Buffer.from(userImageBase64, 'base64'));
      const inputPublicUrl = `${config.imageBaseUrl}/images/${jobId}/input.${ext}`;
      product.top_image_urls = [inputPublicUrl];
      product.images = [{ src: inputPublicUrl, width: 0, height: 0, alt: '' }];
      product.image_count = 1;
      console.log(`[worker:${jobId}] User-uploaded image saved locally (Kie upload failed): ${inputPublicUrl}`);
    }
  }

  // ── Phase 2: Product knowledge analysis ─────────────────────
  await updateJob(jobId, { status: 'analyzing', phase: 'analyzing', productTitle: product.title });
  console.log(`[worker:${jobId}] Analyzing product knowledge...`);

  const knowledge = await analyzeProductKnowledge(product, count);
  console.log(`[worker:${jobId}] Analysis: ${knowledge.core_usps?.length || 0} USPs, ${knowledge.ad_angle_ideas?.length || 0} angle ideas`);

  // ── Phase 3: Creative concept generation ────────────────────
  await updateJob(jobId, { status: 'concepts', phase: 'concepts' });
  console.log(`[worker:${jobId}] Generating ${count} creative concepts...`);

  const concepts = await generateConceptsForBrand(product, knowledge, count, aspectRatio);
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
