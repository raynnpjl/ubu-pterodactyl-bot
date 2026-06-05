import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} from 'discord.js';
import { getMcServers } from './serverCache.js';
import { getResources } from './pterodactyl.js';
import { readPanelState } from './panelState.js';
import { hasAllowedRole } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

const STATUS_SELECT_ID = 'status:select';

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

export function buildStatusPanelPayload(servers) {
  const serverOptions = servers.map((s) => ({
    label: s.name,
    value: s.identifier,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(STATUS_SELECT_ID)
    .setPlaceholder('Select a server to monitor')
    .addOptions(serverOptions);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('MC Server Status')
    .setDescription('Select a server to view its live status.');

  return { embeds: [embed], components: [row] };
}

export async function startStatusPanel(client) {
  const state = readPanelState();
  if (!state.statusPanel) {
    logger.info('statusPanel: no panel state found — awaiting /mcpanel setup');
    return;
  }

  const { channelId, messageId } = state.statusPanel;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      logger.error({ channelId }, 'statusPanel: channel not text-based');
      return;
    }
    const message = await channel.messages.fetch(messageId);
    const servers = await getMcServers();
    const payload = buildStatusPanelPayload(servers);
    await message.edit(payload);
    logger.info({ channelId, messageId }, 'statusPanel: panel refreshed');
  } catch (err) {
    logger.warn({ err, channelId, messageId }, 'statusPanel: failed to refresh; state may be stale');
  }
}

export async function handleStatusSelect(interaction) {
  if (!hasAllowedRole(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to use the status panel.',
      ephemeral: true,
    });
    return;
  }

  const identifier = interaction.values[0];

  await interaction.deferReply({ ephemeral: true });

  let servers;
  try {
    servers = await getMcServers();
  } catch (err) {
    logger.error({ err }, 'statusPanel: failed to load servers');
    await interaction.editReply({
      content: 'Failed to load server list. Try again shortly.',
    });
    return;
  }

  const server = servers.find((s) => s.identifier === identifier);
  if (!server) {
    await interaction.editReply({
      content: 'Server no longer in the list. Try selecting again.',
    });
    return;
  }

  try {
    const resources = await getResources(identifier);
    if (!resources) {
      await interaction.editReply({
        content: `\`${server.name}\`: Unable to fetch status.`,
      });
      return;
    }

    const state = resources.current_state || 'unknown';
    const cpu = resources.cpu_absolute || 0;
    const ram = resources.memory_bytes || 0;
    const disk = resources.disk_bytes || 0;
    const uptime = resources.uptime || 0;

    const embed = new EmbedBuilder()
      .setColor(stateColor(state))
      .setTitle(`${server.name} Status`)
      .setFields(
        { name: 'State', value: `\`${state}\``, inline: true },
        { name: 'CPU', value: `\`${cpu.toFixed(2)}%\``, inline: true },
        { name: 'RAM', value: `\`${formatBytes(ram)}\``, inline: true },
        { name: 'Disk', value: `\`${formatBytes(disk)}\``, inline: true },
        { name: 'Uptime', value: `\`${formatUptime(uptime)}\``, inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    logger.error({ err, identifier, server: server.name }, 'statusPanel: failed to fetch resources');
    await interaction.editReply({
      content: `\`${server.name}\`: Unable to fetch status.`,
    });
  }
}
