import 'dotenv/config';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import * as mcserver from './commands/mcserver.js';
import * as mcpanel from './commands/mcpanel.js';
import { startMonitor } from './services/monitor.js';
import { startControlPanel, handleControlSelect, handleControlButton } from './services/controlPanel.js';
import { startStatusPanel, handleStatusSelect } from './services/statusPanel.js';
import { logger } from './utils/logger.js';
import { getAllowedRoleIds } from './utils/auth.js';

const required = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'PTERO_BASE_URL',
  'PTERO_APP_API_KEY',
  'PTERO_CLIENT_API_KEY',
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  logger.error({ missing }, 'missing required env vars');
  process.exit(1);
}
if (getAllowedRoleIds().length === 0) {
  logger.warn('ALLOWED_ROLE_IDS is empty — all /mcserver invocations will be denied');
}
if (process.env.MONITOR_PING_ROLE_ID && !process.env.MONITOR_ALERT_CHANNEL_ID) {
  logger.warn('MONITOR_PING_ROLE_ID is set but MONITOR_ALERT_CHANNEL_ID is not — crash monitor is disabled');
}

const commands = new Map([
  [mcserver.data.name, mcserver],
  [mcpanel.data.name, mcpanel],
]);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  logger.info({ user: c.user.tag }, 'discord bot ready');
  startMonitor(c).catch((err) => logger.error({ err }, 'failed to start crash monitor'));
  startControlPanel(c).catch((err) => logger.error({ err }, 'failed to start control panel'));
  startStatusPanel(c).catch((err) => logger.error({ err }, 'failed to start status panel'));
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const cmd = commands.get(interaction.commandName);
      if (cmd?.autocomplete) await cmd.autocomplete(interaction);
      return;
    }
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'ctrl:select') {
        await handleControlSelect(interaction);
        return;
      }
      if (interaction.customId === 'status:select') {
        await handleStatusSelect(interaction);
        return;
      }
    }
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('ctrl:action:')) {
        await handleControlButton(interaction);
        return;
      }
    }
    if (interaction.isChatInputCommand()) {
      const cmd = commands.get(interaction.commandName);
      if (!cmd) return;
      await cmd.execute(interaction);
    }
  } catch (err) {
    logger.error({ err, commandName: interaction.commandName }, 'interaction handler crashed');
    if (interaction.isRepliable()) {
      const payload = {
        content: 'Unexpected error. Check bot logs.',
        flags: MessageFlags.Ephemeral,
      };
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {
        /* nothing we can do */
      }
    }
  }
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  client
    .destroy()
    .catch((err) => logger.error({ err }, 'destroy failed'))
    .finally(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

await client.login(process.env.DISCORD_TOKEN);
