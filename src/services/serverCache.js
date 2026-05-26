import { discoverMcServers } from './pterodactyl.js';
import { logger } from '../utils/logger.js';

const TTL_MS = Number(process.env.SERVER_CACHE_TTL_MS || 30000);

let cache = { data: null, expires: 0 };
let inFlight = null;

export async function getMcServers() {
  const now = Date.now();
  if (cache.data && cache.expires > now) return cache.data;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const data = await discoverMcServers();
      cache = { data, expires: Date.now() + TTL_MS };
      return data;
    } catch (err) {
      logger.error({ err }, 'serverCache: discoverMcServers failed');
      if (cache.data) return cache.data;
      throw err;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function invalidate() {
  cache = { data: null, expires: 0 };
}
