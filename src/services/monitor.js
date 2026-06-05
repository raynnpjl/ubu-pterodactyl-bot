import { EmbedBuilder } from 'discord.js';
import { getMcServers } from './serverCache.js';
import { getStatus } from './pterodactyl.js';
import { consumeIntentional } from './intentTracker.js';
import { logger } from '../utils/logger.js';

const POLL_INTERVAL_MS = Number(process.env.MONITOR_POLL_INTERVAL_MS || 60000);
const CRASH_COLOR = 0xed4245;
const RECOVERY_COLOR = 0x57f287;

// identifier -> { state, alerted, name, expectingOffline }
const tracker = new Map();

function crashEmbed(name, prevState) {
  return new EmbedBuilder()
    .setColor(CRASH_COLOR)
    .setTitle('⚠️ Server offline')
    .setDescription(`**${name}** went offline unexpectedly (was \`${prevState}\`).`)
    .setTimestamp();
}

function recoveryEmbed(name) {
  return new EmbedBuilder()
    .setColor(RECOVERY_COLOR)
    .setTitle('✅ Server back online')
    .setDescription(`**${name}** is running again.`)
    .setTimestamp();
}

async function sendCrash(channel, name, prevState) {
  const roleId = process.env.MONITOR_PING_ROLE_ID;
  const payload = { embeds: [crashEmbed(name, prevState)] };
  if (roleId) {
    payload.content = `<@&${roleId}>`;
    payload.allowedMentions = { roles: [roleId] };
  }
  await channel.send(payload);
}

async function sendRecovery(channel, name) {
  await channel.send({ embeds: [recoveryEmbed(name)] });
}

async function pollOnce(channel) {
  let servers;
  try {
    servers = await getMcServers();
  } catch (err) {
    logger.warn({ err }, 'monitor: failed to load server list; skipping tick');
    return;
  }

  const live = new Set(servers.map((s) => s.identifier));
  // Prune servers that left the panel so they don't linger as stale state.
  for (const id of tracker.keys()) {
    if (!live.has(id)) tracker.delete(id);
  }

  const results = await Promise.allSettled(
    servers.map(async (s) => ({ server: s, state: await getStatus(s.identifier) })),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn({ err: result.reason }, 'monitor: getStatus failed; skipping server');
      continue;
    }
    const { server, state } = result.value;
    const id = server.identifier;
    const prev = tracker.get(id);

    // First time we see this server: seed silently, never alert on the baseline.
    if (!prev) {
      tracker.set(id, { state, alerted: false, name: server.name, expectingOffline: false });
      continue;
    }

    // Graceful shutdown passes through 'stopping' — remember it so the following
    // 'offline' is treated as intentional even if the bot didn't issue the stop.
    if (state === 'stopping') {
      prev.expectingOffline = true;
    }

    // Unexpected offline => crash. Only alert on a direct running -> offline drop.
    if (state === 'offline' && prev.state !== 'offline') {
      const intent = consumeIntentional(id);
      const intentional = Boolean(intent) || prev.expectingOffline;
      prev.expectingOffline = false;
      if (!intentional && prev.state === 'running') {
        try {
          await sendCrash(channel, server.name, prev.state);
          prev.alerted = true;
          logger.warn({ server: server.name, prevState: prev.state }, 'monitor: crash alert sent');
        } catch (err) {
          logger.error({ err, server: server.name }, 'monitor: failed to send crash alert');
        }
      }
    }

    // Came back up after a crash alert => recovery notice (once).
    if (state === 'running' && prev.state !== 'running') {
      prev.expectingOffline = false;
      if (prev.alerted) {
        try {
          await sendRecovery(channel, server.name);
          logger.info({ server: server.name }, 'monitor: recovery alert sent');
        } catch (err) {
          logger.error({ err, server: server.name }, 'monitor: failed to send recovery alert');
        }
        prev.alerted = false;
      }
    }

    prev.state = state;
    prev.name = server.name;
  }
}

/**
 * Start the crash monitor. Opt-in: no-op unless MONITOR_ALERT_CHANNEL_ID is set and
 * resolves to a sendable text channel. The first poll seeds baseline state silently.
 */
export async function startMonitor(client) {
  const channelId = process.env.MONITOR_ALERT_CHANNEL_ID;
  if (!channelId) {
    logger.info('monitor: MONITOR_ALERT_CHANNEL_ID unset — crash monitor disabled');
    return;
  }

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (err) {
    logger.error({ err, channelId }, 'monitor: could not fetch alert channel — disabled');
    return;
  }
  if (!channel?.isTextBased()) {
    logger.error({ channelId }, 'monitor: alert channel is not a text channel — disabled');
    return;
  }

  logger.info({ channelId, intervalMs: POLL_INTERVAL_MS }, 'monitor: crash monitor enabled');
  await pollOnce(channel); // seed baseline immediately
  const timer = setInterval(() => {
    pollOnce(channel).catch((err) => logger.error({ err }, 'monitor: poll tick crashed'));
  }, POLL_INTERVAL_MS);
  timer.unref?.(); // don't keep the process alive solely for the monitor
}
