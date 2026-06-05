import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { getMcServers } from './serverCache.js';
import { executeAction } from './serverControl.js';
import { readPanelState, writePanelState } from './panelState.js';
import { hasAllowedRole } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

const CTRL_SELECT_ID = 'ctrl:select';
const CTRL_ACTION_PREFIX = 'ctrl:action:';

function buildButtons(identifier) {
  const actions = ['start', 'stop', 'restart', 'kill'];
  const buttons = actions.map((action) => {
    let style = ButtonStyle.Primary;
    if (action === 'start') {
      style = ButtonStyle.Success;
    } else if (action === 'stop' || action === 'kill') {
      style = ButtonStyle.Danger;
    }

    return new ButtonBuilder()
      .setCustomId(`${CTRL_ACTION_PREFIX}${action}:${identifier}`)
      .setLabel(action.charAt(0).toUpperCase() + action.slice(1))
      .setStyle(style);
  });

  return new ActionRowBuilder().addComponents(buttons);
}

export function buildControlPanelPayload(servers, opts = {}) {
  const defaultId = servers[0]?.identifier;
  const defaultName = servers[0]?.name;

  const { selectedId = defaultId, selectedName = defaultName, resultText = null } = opts;

  let description = resultText ? `Selected: ${selectedName}\n${resultText}` : `Selected: ${selectedName}`;

  const serverOptions = servers.map((s) => ({
    label: s.name,
    value: s.identifier,
    default: s.identifier === selectedId,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(CTRL_SELECT_ID)
    .setPlaceholder('Select a server')
    .addOptions(serverOptions);

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);
  const buttonRow = buildButtons(selectedId);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('MC Server Control Panel')
    .setDescription(description);

  return { embeds: [embed], components: [selectRow, buttonRow] };
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
      flags: MessageFlags.Ephemeral,
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
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const server = servers.find((s) => s.identifier === identifier);
  if (!server) {
    await interaction.reply({
      content: 'Server no longer in the list. Try selecting again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const payload = buildControlPanelPayload(servers, {
    selectedId: identifier,
    selectedName: server.name,
  });

  await interaction.update(payload);
}

export async function handleControlButton(interaction) {
  if (!hasAllowedRole(interaction)) {
    await interaction.reply({
      content: 'You do not have permission to perform this action.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parts = interaction.customId.split(':');
  const action = parts[2];
  const identifier = parts[3];

  if (!action || !identifier) {
    await interaction.reply({
      content: 'Invalid button. Try selecting a server again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  let servers;
  try {
    servers = await getMcServers();
  } catch (err) {
    logger.error({ err }, 'controlPanel: failed to load servers for action execution');
    const server = servers.find((s) => s.identifier === identifier);
    await interaction.editReply(
      buildControlPanelPayload(servers, {
        selectedId: identifier,
        selectedName: server?.name || 'Unknown',
        resultText: 'Failed to load server list. Try again shortly.',
      })
    );
    return;
  }

  const server = servers.find((s) => s.identifier === identifier);
  if (!server) {
    await interaction.editReply(
      buildControlPanelPayload(servers, {
        selectedId: identifier,
        selectedName: 'Unknown',
        resultText: 'Server not found.',
      })
    );
    return;
  }

  const result = await executeAction(identifier, action, {
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    servers,
  });

  const payload = buildControlPanelPayload(servers, {
    selectedId: identifier,
    selectedName: server.name,
    resultText: result,
  });

  await interaction.editReply(payload);
}
