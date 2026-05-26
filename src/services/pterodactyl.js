import { request } from 'undici';
import { logger } from '../utils/logger.js';

const TIMEOUT_MS = 5000;

export class PteroError extends Error {
  constructor(message, { code, status, cause } = {}) {
    super(message);
    this.name = 'PteroError';
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

function baseUrl() {
  const url = process.env.PTERO_BASE_URL;
  if (!url) throw new PteroError('PTERO_BASE_URL not set', { code: 'CONFIG' });
  return url.replace(/\/+$/, '');
}

async function pteroFetch(path, { method = 'GET', apiKey, body } = {}) {
  if (!apiKey) {
    throw new PteroError('Pterodactyl API key missing', { code: 'CONFIG' });
  }
  const url = `${baseUrl()}${path}`;
  let res;
  try {
    res = await request(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      bodyTimeout: TIMEOUT_MS,
      headersTimeout: TIMEOUT_MS,
    });
  } catch (err) {
    if (err?.code === 'UND_ERR_HEADERS_TIMEOUT' || err?.code === 'UND_ERR_BODY_TIMEOUT') {
      throw new PteroError('Pterodactyl panel timeout', { code: 'TIMEOUT', cause: err });
    }
    throw new PteroError('Pterodactyl panel unreachable', {
      code: 'UNREACHABLE',
      cause: err,
    });
  }

  const { statusCode } = res;
  if (statusCode === 204) return null;

  let payload = null;
  try {
    payload = await res.body.json();
  } catch {
    payload = null;
  }

  if (statusCode >= 200 && statusCode < 300) return payload;

  if (statusCode === 401 || statusCode === 403) {
    throw new PteroError('Pterodactyl authentication failed', {
      code: 'AUTH',
      status: statusCode,
    });
  }
  if (statusCode === 404) {
    throw new PteroError('Pterodactyl resource not found', {
      code: 'NOT_FOUND',
      status: statusCode,
    });
  }
  if (statusCode === 409) {
    throw new PteroError('Pterodactyl rejected the action (conflict)', {
      code: 'CONFLICT',
      status: statusCode,
    });
  }
  if (statusCode === 429) {
    throw new PteroError('Pterodactyl rate limit hit', { code: 'RATE_LIMIT', status: statusCode });
  }
  throw new PteroError(`Pterodactyl error (${statusCode})`, {
    code: 'SERVER',
    status: statusCode,
  });
}

async function listAllAppServers() {
  const appKey = process.env.PTERO_APP_API_KEY;
  const perPage = 100;
  const results = [];
  let page = 1;
  while (true) {
    const data = await pteroFetch(
      `/api/application/servers?per_page=${perPage}&page=${page}`,
      { apiKey: appKey },
    );
    if (!data?.data) break;
    results.push(...data.data);
    const total = data.meta?.pagination?.total_pages ?? 1;
    if (page >= total) break;
    page += 1;
  }
  return results;
}

async function findMcNestId(nestName) {
  const appKey = process.env.PTERO_APP_API_KEY;
  const data = await pteroFetch('/api/application/nests', { apiKey: appKey });
  const nests = data?.data ?? [];
  const match = nests.find(
    (n) => (n.attributes?.name || '').toLowerCase() === nestName.toLowerCase(),
  );
  if (!match) {
    throw new PteroError(`Nest "${nestName}" not found in panel`, { code: 'NEST_MISSING' });
  }
  return match.attributes.id;
}

export async function discoverMcServers() {
  const nestName = process.env.MC_NEST_NAME || 'Minecraft';
  const [nestId, servers] = await Promise.all([findMcNestId(nestName), listAllAppServers()]);
  const mc = servers
    .filter((s) => s.attributes?.nest === nestId && !s.attributes?.suspended)
    .map((s) => ({
      identifier: s.attributes.identifier,
      uuid: s.attributes.uuid,
      name: s.attributes.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  logger.debug({ count: mc.length, nestId }, 'discoverMcServers');
  return mc;
}

export async function getStatus(identifier) {
  const clientKey = process.env.PTERO_CLIENT_API_KEY;
  const data = await pteroFetch(`/api/client/servers/${identifier}/resources`, {
    apiKey: clientKey,
  });
  return data?.attributes?.current_state ?? 'unknown';
}

const VALID_SIGNALS = new Set(['start', 'stop', 'restart', 'kill']);

export async function power(identifier, signal) {
  if (!VALID_SIGNALS.has(signal)) {
    throw new PteroError(`Invalid power signal: ${signal}`, { code: 'BAD_SIGNAL' });
  }
  const clientKey = process.env.PTERO_CLIENT_API_KEY;
  await pteroFetch(`/api/client/servers/${identifier}/power`, {
    method: 'POST',
    apiKey: clientKey,
    body: { signal },
  });
}
