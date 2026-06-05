# ubu-pterodactyl-bot

Discord bot that powers Minecraft servers in a Pterodactyl panel from chat.

**Two control modes:**
1. `/mcserver <server> <action>` — slash command; instant reply.
2. `/mcpanel setup` — posts persistent **control panel** (dropdown + buttons) and **status panel** (live stats) in the current channel.

Runs on Node.js 20+, talks to Pterodactyl, managed by systemd.

## How it works

- **Discovery**: Pterodactyl **Application API** lists nests and servers. The bot picks the nest matching `MC_NEST_NAME` (default `Minecraft`) and returns its servers as autocomplete choices.
- **Power**: Pterodactyl **Client API** (`POST /api/client/servers/{id}/power`) issues the signal. Wings handles graceful MC shutdown / world save on `stop` and `restart`. `kill` is a hard SIGKILL — only use it if a server is unresponsive.
- **Cache**: The MC server list is cached in memory for `SERVER_CACHE_TTL_MS` (default 30s) so autocomplete stays under Discord's 3s deadline.
- **Permissions**: Only members with at least one role in `ALLOWED_ROLE_IDS` can run the command. Anyone else gets an ephemeral denial.
- **Crash monitor** (opt-in): when `MONITOR_ALERT_CHANNEL_ID` is set, the bot polls every server's power state every `MONITOR_POLL_INTERVAL_MS` and posts a red alert (optionally pinging `MONITOR_PING_ROLE_ID`) when a server drops from `running` to `offline` unexpectedly, plus a green notice when it recovers. Stops/kills/restarts issued through the bot are suppressed. **Limitation**: the Pterodactyl API doesn't report *why* a server stopped, so a stop issued directly in the panel or game console may trigger a false crash alert (the bot suppresses ones that pass through the `stopping` state, but a poll can miss it).

## Prerequisites

- Node.js 20 LTS (`node --version` ≥ 20).
- Pterodactyl panel reachable from the bot host
- A Discord application + bot. From <https://discord.com/developers/applications>:
  - Bot token (`DISCORD_TOKEN`).
  - Application ID (`DISCORD_CLIENT_ID`).
  - The guild (server) ID you'll invite it to (`DISCORD_GUILD_ID`).
  - Invite the bot with at least the `applications.commands` and `bot` scopes. No privileged intents are needed.

## Pterodactyl API keys

Two keys, two scopes:

1. **Application API key** — admin panel → *Application API* → Create. Read scope on **Servers** and **Nests** is enough.
2. **Client API key** — user account settings → *API Credentials* → Create. The account that owns this key must have access to every MC server the bot will control.

Both go in `.env`.

## Discord role setup

1. Create a role in your guild (e.g. `mc-admin`).
2. Right-click the role → Copy Role ID (requires Developer Mode in Discord settings).
3. Put the ID into `ALLOWED_ROLE_IDS`. Multiple IDs are comma-separated.

## Local dev setup (ubuntu)

```bash
git clone https://github.com/raynnpjl/ubu-pterodactyl-bot
cd ubu-pterodactyl-bot
touch .env
chmod 600 .env
# fill .env with the keys from the Configuration reference below
npm install
npm run deploy
npm start
```

Then in Discord: type `/mcserver` and pick from the dropdown.

## Configuration reference

| Key | Purpose |
|-----|---------|
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_CLIENT_ID` | Application ID (used for command registration) |
| `DISCORD_GUILD_ID` | Guild ID — command is registered per-guild (instant updates) |
| `ALLOWED_ROLE_IDS` | Comma-separated Discord role IDs allowed to run `/mcserver` |
| `PTERO_BASE_URL` | Panel base URL, e.g. `http://localhost` |
| `PTERO_APP_API_KEY` | Application API key (server + nest discovery) |
| `PTERO_CLIENT_API_KEY` | Client API key (power actions) |
| `MC_NEST_NAME` | Nest name used to filter MC servers (default `Minecraft`) |
| `SERVER_CACHE_TTL_MS` | Cache TTL for autocomplete (default `30000`) |
| `MONITOR_ALERT_CHANNEL_ID` | Channel ID for crash alerts. **Unset disables the crash monitor.** |
| `MONITOR_POLL_INTERVAL_MS` | Crash-monitor poll cadence (default `60000`) |
| `MONITOR_POLL_INTERVAL_MS` | Status-monitor poll cadence (default `10000`) |
| `MONITOR_PING_ROLE_ID` | Optional role ID to `@mention` on a crash alert |
| `LOG_LEVEL` | `trace` / `debug` / `info` / `warn` / `error` (default `info`) |

## Testing

1. `curl -H "Authorization: Bearer $PTERO_APP_API_KEY" "$PTERO_BASE_URL/api/application/nests" | jq` — Minecraft nest visible.
2. `npm run deploy` — Discord registers both `/mcserver` and `/mcpanel` commands.
3. `npm start` — bot logs `discord bot ready` and "no panel state found — awaiting /mcpanel setup".
4. **Slash command** (`/mcserver`):
   - `/mcserver` → dropdown lists every MC server in your panel.
   - Pick a test server → `start` → reply within ~1s; panel console shows boot.
   - Re-issue `start` → "already running" reply (no-op short-circuit).
5. **Persistent panels** (`/mcpanel`):
   - Run `/mcpanel setup` in a test channel → two messages appear (Control Panel and Status Panel).
   - Bot logs "panels posted" and creates `panel-state.json`.
   - **Control Panel** — select server from dropdown → ephemeral response with 4 action buttons.
     Click an action → ephemeral shows result, buttons vanish.
   - **Status Panel** — select server → ephemeral shows state / CPU / RAM / disk / uptime.
   - Bot restart → panels refresh (dropdowns updated), no new messages posted.
6. **Role check** — use an account without the allowed role → "not authorized" for both slash command and panels.
7. **Crash monitor** (separate channel, optional):
   - Set `MONITOR_ALERT_CHANNEL_ID` to a Discord channel ID.
   - Restart bot → logs "crash monitor enabled".
   - Kill a test server from the panel → red alert appears in the monitor channel within one poll tick.
   - Start it back → green "back online" notice once.