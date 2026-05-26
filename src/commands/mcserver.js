import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getMcServers, invalidate } from '../services/serverCache.js';
import { getStatus, power, PteroError } from '../services/pterodactyl.js';
import { hasAllowedRole } from '../utils/auth.js';
import { logger } from '../utils/logger.js';

const ACTIONS = ['start', 'stop', 'restart', 'kill'];

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
    await interaction.editReply(mapErrorMessage(err));
    return;
  }

  const server = servers.find((s) => s.identifier === identifier);
  if (!server) {
    invalidate();
    logger.warn({ identifier, action, userId }, 'stale identifier rejected');
    await interaction.editReply(
      'That server is no longer in the Minecraft list. Run the command again to refresh.',
    );
    return;
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
    await interaction.editReply(`\`${server.name}\`: ${noop}`);
    return;
  }

  try {
    await power(identifier, action);
  } catch (err) {
    logger.error(
      { err, userId, userTag, server: server.name, action },
      'power action failed',
    );
    await interaction.editReply(`\`${server.name}\`: ${mapErrorMessage(err)}`);
    return;
  }

  logger.info(
    { userId, userTag, server: server.name, action, prevState, result: 'sent' },
    'audit',
  );
  await interaction.editReply(
    `✅ \`${action}\` sent to \`${server.name}\` (was \`${prevState}\`).`,
  );
}
