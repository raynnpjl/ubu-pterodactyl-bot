import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { data as mcserverData } from './commands/mcserver.js';
import { data as mcpanelData } from './commands/mcpanel.js';
import { logger } from './utils/logger.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  logger.error('DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID must be set in .env');
  process.exit(1);
}

const commands = [mcserverData.toJSON(), mcpanelData.toJSON()];

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

try {
  logger.info({ count: commands.length }, 'registering guild commands');
  const result = await rest.put(
    Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID),
    { body: commands },
  );
  logger.info({ registered: result.length }, 'commands registered');
} catch (err) {
  logger.error({ err }, 'failed to register commands');
  process.exit(1);
}
