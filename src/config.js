import 'dotenv/config';

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  // Security — used by Chrome extension to authenticate requests
  apiKey: required('API_KEY'),

  // Redis
  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  // Anthropic (Claude) — used for brand vision analysis + concept generation
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  anthropicModel: optional('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),

  // Kie.ai — Banana image generation
  kieAiApiKey: required('KIE_AI_API_KEY'),
  kieAiBaseUrl: optional('KIE_AI_BASE_URL', 'https://api.kie.ai/api/v1'),
  kieAiModel: optional('KIE_AI_MODEL', 'nano-banana-2'),

  // Generation
  concurrentGenerations: parseInt(optional('CONCURRENT_GENERATIONS', '3'), 10),
  pollIntervalMs: parseInt(optional('POLL_INTERVAL_MS', '5000'), 10),
  pollTimeoutMs: parseInt(optional('POLL_TIMEOUT_MS', '300000'), 10),

  // Storage — where generated images are saved inside the container
  imagesDir: optional('IMAGES_DIR', '/app/images'),

  // Public URL of this server — used to build image URLs returned to the extension
  imageBaseUrl: required('IMAGE_BASE_URL'),

  // Job TTL in Redis (default 24h)
  jobTtlSeconds: parseInt(optional('JOB_TTL_SECONDS', String(24 * 60 * 60)), 10),
};
