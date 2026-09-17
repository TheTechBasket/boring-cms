#!/usr/bin/env node
// Boring CMS launcher for `npx boring-cms` / `pnpm dlx boring-cms`.
// The npm tarball ships type-stripped .js (Node refuses to strip types under
// node_modules); a repo checkout has only the .ts sources.
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`Boring CMS needs Node 24 or newer (you have ${process.version}).`);
  process.exit(1);
}

// node:sqlite still emits an ExperimentalWarning on import; it is stable
// enough for us (engines >=24) and the warning is pure noise on startup.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning?.message ?? warning).includes('SQLite')) return;
  return emitWarning.call(process, warning, ...rest);
};

// One stable home per machine: ~/.boring-cms holds .env and data/, so
// `npx boring-cms` from any directory always finds the same instance
// (never the ephemeral npx cache the package lands in).
const { mkdirSync, readFileSync } = await import('node:fs');
const { homedir } = await import('node:os');
const path = (await import('node:path')).default;
const baseDir = process.env.BORING_CMS_HOME || path.join(homedir(), '.boring-cms');
mkdirSync(baseDir, { recursive: true });

const { createApp } = await import('../server.js').catch(() => import('../server.ts'));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const app = createApp({ baseDir });
// Plain ANSI, no dependency: colors only on a real terminal, NO_COLOR honored.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const green = (s) => c('32', s);
const cyan = (s) => c('36', s);
const dim = (s) => c('2', s);
// OSC 8 terminal hyperlink: clickable in modern terminals, plain text elsewhere.
const link = (text, url) => (useColor ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text);

const port = app.appConfig.port;

// Port taken? Say so and exit. Never silently pick another: a production
// proxy points at a fixed port, so a surprise port is a silent outage.
app.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`${bold(`Port ${port} is already in use.`)}`);
  console.error(`  Pick a free port: ${cyan('PORT=3423 npx boring-cms')}`);
  const envPath = path.join(baseDir, '.env').replace(homedir(), '~');
  console.error(`  ${dim(`or set PORT in ${envPath}`)}`);
  process.exit(1);
});

app.listen(port, () => {
  const ms = Math.round(process.uptime() * 1000);
  const took = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const adminUrl = `http://localhost:${port}`;
  console.log(`${bold(`Boring CMS v${version}`)} ${dim('ready in')} ${green(took)}`);
  console.log(`  ${dim('Admin:')} ${cyan(link(adminUrl, adminUrl))}`);
  console.log(`  ${dim('Data:')}  ${link(baseDir, `file://${baseDir}`)}`);
});
