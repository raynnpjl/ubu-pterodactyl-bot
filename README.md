# ubu-discord-bot

Discord bot that powers Minecraft servers in a Pterodactyl panel from chat.

```
/mcserver <mc_server> <action>
```

- `<mc_server>` — autocomplete dropdown of all Minecraft servers in your panel (filtered by nest name).
- `<action>` — `start` | `stop` | `restart` | `kill`.

Runs on Node.js 20+, talks to Pterodactyl, managed by systemd.

## How it works

- **Discovery**: Pterodactyl **Application API** lists nests and servers. The bot picks the nest matching `MC_NEST_NAME` (default `Minecraft`) and returns its servers as autocomplete choices.
- **Power**: Pterodactyl **Client API** (`POST /api/client/servers/{id}/power`) issues the signal. Wings handles graceful MC shutdown / world save on `stop` and `restart`. `kill` is a hard SIGKILL — only use it if a server is unresponsive.
- **Cache**: The MC server list is cached in memory for `SERVER_CACHE_TTL_MS` (default 30s) so autocomplete stays under Discord's 3s deadline.
- **Permissions**: Only members with at least one role in `ALLOWED_ROLE_IDS` can run the command. Anyone else gets an ephemeral denial.

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

## Local dev setup

```bash
git clone <your repo> ubu-discord-bot
cd ubu-discord-bot
cp .env.example .env
chmod 600 .env
# edit .env: fill in all values
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
| `LOG_LEVEL` | `trace` / `debug` / `info` / `warn` / `error` (default `info`) |

## Smoke test checklist

1. `curl -H "Authorization: Bearer $PTERO_APP_API_KEY" "$PTERO_BASE_URL/api/application/nests" | jq` — Minecraft nest visible.
2. `npm run deploy` — Discord registers the command.
3. `npm start` — bot logs `discord bot ready`.
4. In Discord: `/mcserver` — dropdown lists every MC server in your panel.
5. Pick a test server → `start` → reply within ~1s; panel console shows boot.
6. Re-issue `start` → "already running" reply (no-op short-circuit).
7. Stop the panel briefly → command returns "panel unreachable" within 5s.
8. Use an account without the allowed role → "not authorized" reply.