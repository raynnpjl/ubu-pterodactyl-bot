import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildControlPanelPayload } from '../services/controlPanel.js';
import { buildStatusPanelPayload } from '../services/statusPanel.js';
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

    const controlPayload = buildControlPanelPayload(servers);
    const statusPayload = buildStatusPanelPayload(servers);

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
      },
    });

    logger.info(
      {
        userId: interaction.user.id,
        channelId: interaction.channel.id,
        controlMsgId: controlMsg.id,
        statusMsgId: statusMsg.id,
      },
      'mcpanel: panels posted'
    );

    await interaction.editReply(
      'Control panel and status panel posted to this channel.'
    );
  } catch (err) {
    logger.error({ err }, 'mcpanel: setup failed');
    await interaction.editReply('Failed to post panels. Check bot logs.');
  }
}
