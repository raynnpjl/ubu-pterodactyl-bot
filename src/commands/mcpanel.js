import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildControlPanelPayload } from '../services/controlPanel.js';
import { buildStatusPanelPayload, attachStatusPanel } from '../services/statusPanel.js';
import { getResources } from '../services/pterodactyl.js';
import { writePanelState } from '../services/panelState.js';
import { hasAllowedRole } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('mcpanel')
  .setDescription('Set up persistent control and status panels.')
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('setup')
      .setDescription('Post the control and status panels in this channel.')
  );

export async function execute(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand !== 'setup') {
    await interaction.reply({
      content: 'Unknown subcommand.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasAllowedRole(interaction)) {
    logger.warn(
      { userId: interaction.user.id, userTag: interaction.user.tag },
      'mcpanel: denied — role check'
    );
    await interaction.reply({
      content: 'You do not have permission to run this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { getMcServers } = await import('../services/serverCache.js');
    const servers = await getMcServers();

    if (!servers.length) {
      await interaction.editReply('No Minecraft servers found in the panel.');
      return;
    }

    const controlPayload = buildControlPanelPayload(servers);
    const selectedId = servers[0].identifier;
    const resources = await getResources(selectedId).catch(() => null);
    const statusPayload = buildStatusPanelPayload(servers, selectedId, resources);

    const controlMsg = await interaction.channel.send(controlPayload);
    const statusMsg = await interaction.channel.send(statusPayload);

    await writePanelState({
      controlPanel: {
        channelId: interaction.channel.id,
        messageId: controlMsg.id,
      },
      statusPanel: {
        channelId: interaction.channel.id,
        messageId: statusMsg.id,
        selectedIdentifier: selectedId,
      },
    });

    await attachStatusPanel(statusMsg, servers);

    logger.info(
      {
        userId: interaction.user.id,
        channelId: interaction.channel.id,
        controlMsgId: controlMsg.id,
        statusMsgId: statusMsg.id,
        selectedId,
      },
      'mcpanel: panels posted and polling started'
    );

    await interaction.editReply(
      'Control panel and status panel posted to this channel. Status panel is now live!'
    );
  } catch (err) {
    logger.error({ err }, 'mcpanel: setup failed');
    await interaction.editReply('Failed to post panels. Check bot logs.');
  }
}
