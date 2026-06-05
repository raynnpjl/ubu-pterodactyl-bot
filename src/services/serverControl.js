import { getStatus, power, PteroError } from './pterodactyl.js';
import { markIntentional } from './intentTracker.js';
import { logger } from '../utils/logger.js';

function mapErrorMessage(err) {
  if (!(err instanceof PteroError)) return 'Unexpected error. Check bot logs.';
  switch (err.code) {
    case 'TIMEOUT':
    case 'UNREACHABLE':
      return 'Pterodactyl panel is unreachable. Try again shortly.';
    case 'AUTH':
      return 'Bot is not authorized to talk to the panel. Check API keys.';
    case 'NOT_FOUND':
      return 'Server not found on the panel (may have been removed).';
    case 'CONFLICT':
      return 'Panel rejected the action (server may be suspended or installing).';
    case 'RATE_LIMIT':
      return 'Hit Pterodactyl rate limit. Wait a few seconds and retry.';
    case 'NEST_MISSING':
      return 'Minecraft nest not found in panel. Check MC_NEST_NAME.';
    case 'CONFIG':
      return 'Bot is misconfigured. Check environment variables.';
    default:
      return 'Panel returned an error. Check bot logs.';
  }
}

function noopMessage(action, state) {
  if (action === 'start' && (state === 'running' || state === 'starting')) {
    return `Server already \`${state}\`. No action sent.`;
  }
  if (action === 'stop' && (state === 'offline' || state === 'stopping')) {
    return `Server already \`${state}\`. No action sent.`;
  }
  return null;
}

export async function executeAction(identifier, action, { userId, userTag, servers }) {
  const server = servers.find((s) => s.identifier === identifier);
  if (!server) {
    return `Server not found (may have been removed).`;
  }

  if (action === 'status') {
    try {
      const state = await getStatus(identifier);
      logger.info(
        { userId, userTag, server: server.name, action, prevState: state, result: 'status' },
        'audit',
      );
      return `\`${server.name}\`: status is \`${state}\`.`;
    } catch (err) {
      logger.error({ err, userId, userTag, server: server.name, action }, 'status query failed');
      return `\`${server.name}\`: ${mapErrorMessage(err)}`;
    }
  }

  let prevState = 'unknown';
  try {
    prevState = await getStatus(identifier);
  } catch (err) {
    logger.warn({ err, identifier }, 'getStatus failed; proceeding without precheck');
  }

  const noop = noopMessage(action, prevState);
  if (noop) {
    logger.info(
      { userId, userTag, server: server.name, action, prevState, result: 'noop' },
      'audit',
    );
    return `\`${server.name}\`: ${noop}`;
  }

  if (action !== 'start') {
    markIntentional(identifier, action);
  }

  try {
    await power(identifier, action);
  } catch (err) {
    logger.error(
      { err, userId, userTag, server: server.name, action },
      'power action failed',
    );
    return `\`${server.name}\`: ${mapErrorMessage(err)}`;
  }

  logger.info(
    { userId, userTag, server: server.name, action, prevState, result: 'sent' },
    'audit',
  );
  return `✅ \`${action}\` sent to \`${server.name}\` (was \`${prevState}\`).`;
}
