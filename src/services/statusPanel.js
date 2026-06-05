import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import { getMcServers } from './serverCache.js';
import { getResources } from './pterodactyl.js';
import { readPanelState, writePanelState } from './panelState.js';
import { hasAllowedRole } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

const STATUS_SELECT_ID = 'status:select';
const POLL_INTERVAL_MS = Number(process.env.MONITOR_POLL_INTERVAL_MS || 10000);

// Module-level state for the live status panel
let statusMessage = null;
let currentSelectedId = null;
let statusPollTimer = null;

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatUptime(seconds) {
  if (!seconds || seconds < 0) return 'N/A';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function stateColor(state) {
  switch (state) {
    case 'running':
      return 0x57f287; // green
    case 'offline':
      return 0xed4245; // red
    case 'starting':
    case 'stopping':
      return 0xfaa61a; // yellow
    default:
      return 0x99aab5; // gray
  }
}

export function buildStatusPanelPayload(servers, selectedId, resources = null) {
  const serverOptions = servers.map((s) => ({
    label: s.name,
    value: s.identifier,
    default: s.identifier === selectedId,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(STATUS_SELECT_ID)
    .setPlaceholder('Select a server to monitor')
    .addOptions(serverOptions);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  if (!resources) {
    const embed = new EmbedBuilder()
      .setColor(0x99aab5)
      .setTitle('MC Server Status')
      .setDescription('Loading…');
    return { embeds: [embed], components: [row] };
  }

  const server = servers.find((s) => s.identifier === selectedId);
  const serverName = server?.name || 'Unknown';
  const state = resources.current_state || 'unknown';
  const cpu = resources.cpu_absolute || 0;
  const ram = resources.memory_bytes || 0;
  const disk = resources.disk_bytes || 0;
  const uptime = resources.uptime || 0;

  const embed = new EmbedBuilder()
    .setColor(stateColor(state))
    .setTitle(`${serverName} Status`)
    .setFields(
      { name: 'State', value: `\`${state}\``, inline: true },
      { name: 'CPU', value: `\`${cpu.toFixed(2)}%\``, inline: true },
      { name: 'RAM', value: `\`${formatBytes(ram)}\``, inline: true },
      { name: 'Disk', value: `\`${formatBytes(disk)}\``, inline: true },
      { name: 'Uptime', value: `\`${formatUptime(uptime)}\``, inline: true },
    )
    .setTimestamp();

  return { embeds: [embed], components: [row] };
}

async function pollStatusPanel() {
  if (!statusMessage || !currentSelectedId) return;

  try {
    const servers = await getMcServers();
    const resources = await getResources(currentSelectedId).catch(() => null);
    logger.debug({ selectedId: currentSelectedId, resources }, 'statusPanel: poll tick');
    const payload = buildStatusPanelPayload(servers, currentSelectedId, resources);
    await statusMessage.edit(payload);
  } catch (err) {
    logger.warn({ err, selectedId: currentSelectedId }, 'statusPanel: poll tick failed');
  }
}

async function initStatusPanelPolling(message, servers, selectedId) {
  statusMessage = message;
  currentSelectedId = selectedId;

  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }

  try {
    const resources = await getResources(selectedId).catch(() => null);
    const payload = buildStatusPanelPayload(servers, selectedId, resources);
    await statusMessage.edit(payload);
  } catch (err) {
    logger.warn({ err, selectedId }, 'statusPanel: initial update failed');
  }

  statusPollTimer = setInterval(() => {
    pollStatusPanel().catch((err) => logger.error({ err }, 'statusPanel: poll crashed'));
  }, POLL_INTERVAL_MS);
  statusPollTimer.unref?.();

  logger.info(
    { channelId: message.channelId, messageId: message.id, selectedId, intervalMs: POLL_INTERVAL_MS },
    'statusPanel: polling started'
  );
}

export async function startStatusPanel(client) {
  const state = readPanelState();
  if (!state.statusPanel) {
    logger.info('statusPanel: no panel state found — awaiting /mcpanel setup');
    return;
  }

  const { channelId, messageId, selectedIdentifier } = state.statusPanel;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      logger.error({ channelId }, 'statusPanel: channel not text-based');
      return;
    }
    const message = await channel.messages.fetch(messageId);
    const servers = await getMcServers();
    const selectedId = selectedIdentifier || servers[0]?.identifier;

    if (!selectedId) {
      logger.warn('statusPanel: no servers available');
      return;
    }

    await initStatusPanelPolling(message, servers, selectedId);
  } catch (err) {
    logger.warn({ err, channelId, messageId }, 'statusPanel: failed to start; state may be stale');
  }
}

export async function attachStatusPanel(message, servers) {
  const selectedId = servers[0]?.identifier;
  if (!selectedId) {
    logger.warn('statusPanel: no servers available for attachment');
    return;
  }
  await initStatusPanelPolling(message, servers, selectedId);
}

export async function handleStatusSelect(interaction) {
  if (!hasAllowedRole(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to use the status panel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const identifier = interaction.values[0];
  currentSelectedId = identifier;

  // Persist the new selection
  const state = readPanelState();
  if (state.statusPanel) {
    state.statusPanel.selectedIdentifier = identifier;
    await writePanelState(state).catch((err) =>
      logger.warn({ err }, 'statusPanel: failed to persist selection')
    );
  }

  await interaction.deferUpdate();

  try {
    const servers = await getMcServers();
    const resources = await getResources(identifier).catch(() => null);
    const payload = buildStatusPanelPayload(servers, identifier, resources);
    await interaction.editReply(payload);
  } catch (err) {
    logger.error({ err, identifier }, 'statusPanel: failed to update after select');
  }
}
