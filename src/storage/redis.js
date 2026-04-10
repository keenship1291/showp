import Redis from 'ioredis';
import { config } from '../config.js';

// BullMQ requires maxRetriesPerRequest: null on its connections
export function createBullConnection() {
  const conn = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  conn.on('error', err => console.error('[redis:bull]', err.message));
  return conn;
}

// General-purpose app connection for job state reads/writes
let _appClient = null;

export function getAppRedis() {
  if (!_appClient) {
    _appClient = new Redis(config.redisUrl);
    _appClient.on('error', err => console.error('[redis:app]', err.message));
  }
  return _appClient;
}
