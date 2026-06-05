import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { getMcServers } from './serverCache.js';
import { executeAction } from './serverControl.js';
import { readPanelState, writePanelState } from './panelState.js';
import { hasAllowedRole } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

const CTRL_SELECT_ID = 'ctrl:select';
const CTRL_ACTION_PREFIX = 'ctrl:action:';

export function buildControlPanelPayload(servers) {
  const serverOptions = servers.map((s) => ({
    label: s.name,
    value: s.identifier,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(CTRL_SELECT_ID)
    .setPlaceholder('Select a server')
    .addOptions(serverOptions);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('MC Server Control Panel')
    .setDescription('Select a server, then choose an action in the ephemeral response.');

  return { embeds: [embed], components: [row] };
}

export async function startControlPanel(client) {
  const state = readPanelState();
  if (!state.controlPanel) {
    logger.info('controlPanel: no panel state found — awaiting /mcpanel setup');
    return;
  }

  const { channelId, messageId } = state.controlPanel;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      logger.error({ channelId }, 'controlPanel: channel not text-based');
      return;
    }
    const message = await channel.messages.fetch(messageId);
    const servers = await getMcServers();
    const payload = buildControlPanelPayload(servers);
    await message.edit(payload);
    logger.info({ channelId, messageId }, 'controlPanel: panel refreshed');
  } catch (err) {
    logger.warn({ err, channelId, messageId }, 'controlPanel: failed to refresh; state may be stale');
  }
}

export async function handleControlSelect(interaction) {
  if (!hasAllowedRole(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to use the control panel.',
      ephemeral: true,
    });
    return;
  }

  const identifier = interaction.values[0];
  let servers;
  try {
    servers = await getMcServers();
  } catch (err) {
    logger.error({ err }, 'controlPanel: failed to load servers for action buttons');
    await interaction.reply({
      content: 'Failed to load server list. Try again shortly.',
      ephemeral: true,
    });
    return;
  }

  const server = servers.find((s) => s.identifier === identifier);
  if (!server) {
    await interaction.reply({
      content: 'Server no longer in the list. Try selecting again.',
      ephemeral: true,
    });
    return;
  }

  const actions = ['start', 'stop', 'restart', 'kill'];
  const buttons = actions.map((action) => {
    let style = ButtonStyle.Primary;
    let emoji = '';
    if (action === 'start') {
      style = ButtonStyle.Success;
      emoji = '▶';
    } else if (action === 'stop' || action === 'kill') {
      style = ButtonStyle.Danger;
      emoji = action === 'stop' ? '⏹' : '✕';
    } else if (action === 'restart') {
      style = ButtonStyle.Primary;
      emoji = '↻';
    }
    return new ButtonBuilder()
      .setCustomId(`${CTRL_ACTION_PREFIX}${action}:${identifier}`)
      .setLabel(action.charAt(0).toUpperCase() + action.slice(1))
      .setStyle(style)
      .setEmoji(emoji);
  });

  const row = new ActionRowBuilder().addComponents(buttons);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Selected: ${server.name}`)
    .setDescription('Choose an action below.');

  await interaction.reply({
    embeds: [embed],
    components: [row],
    ephemeral: true,
  });
}

export async function handleControlButton(interaction) {
  if (!hasAllowedRole(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to perform this action.',
      ephemeral: true,
    });
    return;
  }

  const [, action, identifier] = interaction.customId.split(':');

  await interaction.deferUpdate();

  let servers;
  try {
    servers = await getMcServers();
  } catch (err) {
    logger.error({ err }, 'controlPanel: failed to load servers for action execution');
    await interaction.editReply({
      content: 'Failed to load server list. Try again shortly.',
      components: [],
    });
    return;
  }

  const result = await executeAction(identifier, action, {
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    servers,
  });

  await interaction.editReply({
    content: result,
    components: [],
  });
}
