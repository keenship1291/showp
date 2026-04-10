import { Queue } from 'bullmq';
import { createBullConnection } from '../storage/redis.js';
import { config } from '../config.js';

const connection = createBullConnection();

export const pipelineQueue = new Queue('pipeline', {
  connection,
  defaultJobOptions: {
    attempts: 1, // No auto-retry — failed jobs surface error to extension immediately
    removeOnComplete: { age: config.jobTtlSeconds },
    removeOnFail: { age: config.jobTtlSeconds },
  },
});

/**
 * Add a job to the pipeline queue.
 * jobId is used as the BullMQ job ID so queue state aligns with Redis state.
 */
export async function enqueueJob(jobId, data) {
  await pipelineQueue.add('run', data, { jobId });
}
