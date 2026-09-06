// Tiny hand-rolled .env loader. No dotenv dependency.
// Only reads MASTER_KEY, PORT, FORCE_PASSWORD_RESET (and whatever else a
// deployment adds) as bootstrap flags. Everything else lives in core.db.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadConfig(cwd = process.cwd()) {
  const envPath = path.join(cwd, '.env');
  const fileVars = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};

  // process.env wins over .env, .env wins over defaults.
  const get = (key, fallback) => process.env[key] ?? fileVars[key] ?? fallback;

  const masterKey = get('MASTER_KEY', '');
  const port = Number.parseInt(get('PORT', '3000'), 10);
  const forcePasswordReset = get('FORCE_PASSWORD_RESET', '0') === '1';

  const dataDir = get('YNCMS_DATA_DIR', path.join(cwd, 'data'));

  return { masterKey, port, forcePasswordReset, dataDir };
}
