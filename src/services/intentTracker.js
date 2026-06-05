// Shared record of power actions the bot itself issued, so the crash monitor can
// tell an intentional stop/kill/restart apart from an actual crash. Pterodactyl's
// API never reports *why* a server went offline, so this is the only reliable signal
// for bot-initiated shutdowns.

const POLL_INTERVAL_MS = Number(process.env.MONITOR_POLL_INTERVAL_MS || 10000);
// Grace window: how long an intent stays valid before it expires. Two poll cycles
// gives the monitor at least one tick to observe the resulting offline state.
const GRACE_MS = POLL_INTERVAL_MS * 2;

/** identifier -> { action, at } */
const intents = new Map();

/**
 * Record that the bot just sent `action` to `identifier`. Called right before the
 * power request so the monitor can suppress the expected state change.
 */
export function markIntentional(identifier, action) {
  intents.set(identifier, { action, at: Date.now() });
}

/**
 * Return and clear a still-valid intent for `identifier`, or null if none / expired.
 * Expired entries are pruned on access.
 */
export function consumeIntentional(identifier) {
  const intent = intents.get(identifier);
  if (!intent) return null;
  intents.delete(identifier);
  if (Date.now() - intent.at > GRACE_MS) return null;
  return intent;
}
