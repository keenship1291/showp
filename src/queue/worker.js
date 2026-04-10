import { Worker } from 'bullmq';
import { createBullConnection } from '../storage/redis.js';
import { scrapeShopifyProduct } from '../pipeline/scraper.js';
import { analyzeBrand, generateConceptsForBrand } from '../pipeline/analyzer.js';
import { generateImages } from '../pipeline/generator.js';
import { updateJob, appendImage } from '../storage/jobStore.js';

export async function startWorker() {
  const connection = createBullConnection();

  const worker = new Worker('pipeline', processJob, {
    connection,
    concurrency: 2, // Process up to 2 jobs simultaneously
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
      }).catch(() => {}); // Non-fatal if Redis is unavailable
    }
  });

  console.log('[worker] Pipeline worker started (concurrency: 2)');
  return worker;
}

async function processJob(job) {
  const { jobId, url, count, aspectRatio, resolution } = job.data;

  // ── Phase 1: Scrape ──────────────────────────────────────────
  await updateJob(jobId, { status: 'scraping', phase: 'scraping' });
  console.log(`[worker:${jobId}] Scraping: ${url}`);

  const product = await scrapeShopifyProduct(url);
  console.log(`[worker:${jobId}] Scraped: "${product.title}" (${product.images.length} images)`);

  // ── Phase 2: Brand analysis (Claude Vision) ──────────────────
  await updateJob(jobId, {
    status: 'analyzing',
    phase: 'analyzing',
    productTitle: product.title,
  });
  console.log(`[worker:${jobId}] Analyzing brand identity...`);

  const brandIdentity = await analyzeBrand(product);
  console.log(`[worker:${jobId}] Brand: ${brandIdentity.visual_style}, primary: ${brandIdentity.brand_colors?.primary}`);

  // ── Phase 3: Creative concept generation ────────────────────
  await updateJob(jobId, { status: 'concepts', phase: 'concepts' });
  console.log(`[worker:${jobId}] Generating ${count} creative concepts...`);

  const concepts = await generateConceptsForBrand(product, brandIdentity, count);
  console.log(`[worker:${jobId}] Generated ${concepts.length} concepts`);

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
