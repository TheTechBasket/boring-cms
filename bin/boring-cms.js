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
// .env and ./data belong to the directory the user runs from, not the
// ephemeral npx cache the package lands in.
const app = createApp({ baseDir: process.cwd() });
app.listen(app.appConfig.port, () => {
  console.log(`Boring CMS listening on http://localhost:${app.appConfig.port}`);
});
