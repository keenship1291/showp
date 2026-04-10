import { getAppRedis } from './redis.js';
import { config } from '../config.js';

function key(jobId) {
  return `job:${jobId}`;
}

/**
 * Create a new job record in Redis.
 * @param {string} jobId
 * @param {object} data  Initial fields (url, count, aspectRatio, resolution)
 */
export async function createJob(jobId, data) {
  const redis = getAppRedis();
  const record = {
    ...data,
    status: 'pending',
    phase: 'pending',
    images: [],
    current: 0,
    total: data.count || 0,
    productTitle: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await redis.setex(key(jobId), config.jobTtlSeconds, JSON.stringify(record));
}

/**
 * Read a job record. Returns null if not found.
 */
export async function getJob(jobId) {
  const redis = getAppRedis();
  const raw = await redis.get(key(jobId));
  return raw ? JSON.parse(raw) : null;
}

/**
 * Shallow-merge updates into an existing job record.
 * Preserves all existing fields not included in updates.
 */
export async function updateJob(jobId, updates) {
  const redis = getAppRedis();
  const k = key(jobId);
  const raw = await redis.get(k);
  if (!raw) return;

  const current = JSON.parse(raw);
  const updated = { ...current, ...updates, updatedAt: Date.now() };
  await redis.setex(k, config.jobTtlSeconds, JSON.stringify(updated));
}

/**
 * Append a generated image to a job's image list.
 * @param {string} jobId
 * @param {{ id, url, headline, angle_type }} image
 */
export async function appendImage(jobId, image) {
  const redis = getAppRedis();
  const k = key(jobId);
  const raw = await redis.get(k);
  if (!raw) return;

  const current = JSON.parse(raw);
  current.images = [...(current.images || []), image];
  current.updatedAt = Date.now();
  await redis.setex(k, config.jobTtlSeconds, JSON.stringify(current));
}
