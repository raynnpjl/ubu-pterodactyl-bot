import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '../../panel-state.json');

export function readPanelState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    logger.warn({ err }, 'panelState: failed to read state file');
  }
  return {};
}

export async function writePanelState(state) {
  try {
    await fs.promises.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    logger.error({ err }, 'panelState: failed to write state file');
    throw err;
  }
}
