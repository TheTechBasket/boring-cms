#!/usr/bin/env node
// Boring CMS launcher for `npx boring-cms` / `pnpm dlx boring-cms`.
// Node 24+ runs the TypeScript sources natively (type stripping); no build
// step. Data lands in ./data of the directory you run it from, and a .env
// with a generated SECRET_KEY is written there on first boot.
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`Boring CMS needs Node 24 or newer to run TypeScript natively (you have ${process.version}).`);
  process.exit(1);
}
const { createApp } = await import('../server.ts');
const app = createApp();
app.listen(app.appConfig.port, () => {
  console.log(`Boring CMS listening on http://localhost:${app.appConfig.port}`);
});
