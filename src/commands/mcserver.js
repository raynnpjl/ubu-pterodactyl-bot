import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getMcServers, invalidate } from '../services/serverCache.js';
import { executeAction } from '../services/serverControl.js';
import { hasAllowedRole } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

const ACTIONS = ['start', 'stop', 'restart', 'kill', 'status'];

export const data = new SlashCommandBuilder()
  .setName('mcserver')
  .setDescription('Power control for Minecraft servers in the Pterodactyl panel.')
  .setDMPermission(false)
  .addStringOption((opt) =>
    opt
      .setName('mc_server')
      .setDescription('Which Minecraft server to act on.')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName('action')
      .setDescription('Power action to send.')
      .setRequired(true)
      .addChoices(...ACTIONS.map((a) => ({ name: a, value: a }))),
  );

export async function autocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'mc_server') {
      await interaction.respond([]);
      return;
    }
    const query = (focused.value || '').toLowerCase();
    const servers = await getMcServers();
    const matches = servers
      .filter((s) => !query || s.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((s) => ({ name: s.name, value: s.identifier }));
    await interaction.respond(matches);
  } catch (err) {
    logger.warn({ err }, 'autocomplete failed');
    try {
      await interaction.respond([]);
    } catch {
      /* interaction already expired */
    }
  }
}

export async function execute(interaction) {
  const userTag = interaction.user?.tag;
  const userId = interaction.user?.id;
  const identifier = interaction.options.getString('mc_server', true);
  const action = interaction.options.getString('action', true);

  if (!hasAllowedRole(interaction)) {
    logger.warn({ userId, userTag, identifier, action }, 'denied: role check');
    await interaction.reply({
      content: 'You do not have permission to run this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  let servers;
  try {
    servers = await getMcServers();
  } catch (err) {
    logger.error({ err }, 'execute: failed to load server list');
    await interaction.editReply('Failed to load server list. Try again shortly.');
    return;
  }

  const result = await executeAction(identifier, action, { userId, userTag, servers });
  await interaction.editReply(result);
}
