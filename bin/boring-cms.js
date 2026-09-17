#!/usr/bin/env node
// Boring CMS launcher for `npx boring-cms` / `pnpm dlx boring-cms`.
// The npm tarball ships type-stripped .js (Node refuses to strip types under
// node_modules); a repo checkout has only the .ts sources. Data lands in
// ./data of the directory you run it from, and a .env with a generated
// SECRET_KEY is written there on first boot.
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`Boring CMS needs Node 24 or newer (you have ${process.version}).`);
  process.exit(1);
}
const { createApp } = await import('../server.js').catch(() => import('../server.ts'));
// One stable home per machine: ~/.boring-cms holds .env and data/, so
// `npx boring-cms` from any directory always finds the same instance
// (never the ephemeral npx cache the package lands in).
const { mkdirSync } = await import('node:fs');
const { homedir } = await import('node:os');
const path = (await import('node:path')).default;
const baseDir = process.env.BORING_CMS_HOME || path.join(homedir(), '.boring-cms');
mkdirSync(baseDir, { recursive: true });
const app = createApp({ baseDir });
app.listen(app.appConfig.port, () => {
  console.log(`Boring CMS home: ${baseDir}`);
  console.log(`Boring CMS listening on http://localhost:${app.appConfig.port}`);
});
