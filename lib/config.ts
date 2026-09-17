// Tiny hand-rolled .env loader. No dotenv dependency.
// Only reads MASTER_KEY, PORT, FORCE_PASSWORD_RESET (and whatever else a
// deployment adds) as bootstrap flags. Everything else lives in core.db.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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

  // True first boot: no .env at all and no key in the environment.
  // Generate one so `pnpm i && node server.js` just works.
  if (!existsSync(envPath) && !process.env.SECRET_KEY && !process.env.MASTER_KEY) {
    const generated = randomBytes(32).toString('base64url');
    // Write the full commented .env.example as the starting .env so every
    // knob is visible without hunting for docs; fall back to the minimum.
    let template = `SECRET_KEY=${generated}\nPORT=3000\n`;
    try {
      template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8').replace(
        /^SECRET_KEY=.*$/m,
        `SECRET_KEY=${generated}`,
      );
    } catch {}
    writeFileSync(envPath, template, { mode: 0o600 });
    console.log(`Boring CMS: no .env found, created one with a generated SECRET_KEY at ${envPath}`);
    console.log('Boring CMS: back it up. Losing SECRET_KEY makes encrypted settings unreadable.');
  }

  const fileVars = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};

  // process.env wins over .env, .env wins over defaults.
  const get = (key, fallback) => process.env[key] ?? fileVars[key] ?? fallback;

  // SECRET_KEY is the canonical name; MASTER_KEY accepted for older deploys.
  const masterKey = get('SECRET_KEY', '') || get('MASTER_KEY', '');
  const port = Number.parseInt(get('PORT', '3000'), 10);
  const forcePasswordReset = get('FORCE_PASSWORD_RESET', '0') === '1';

  const dataDir = get('YNCMS_DATA_DIR', path.join(cwd, 'data'));

  // Behind a TLS-terminating proxy: honor x-forwarded-proto and mark
  // session cookies Secure on https requests.
  const trustProxy = get('TRUST_PROXY', '0') === '1';

  return { masterKey, port, forcePasswordReset, dataDir, trustProxy };
}
