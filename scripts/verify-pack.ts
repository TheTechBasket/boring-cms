// Pre-publish gate: builds the real npm tarball, installs it in a temp
// directory, boots the packaged server with an isolated home, and asserts
// it answers. Then runs the repo smoke suite and the full benchmark
// against the packaged server. Fails if the tarball ships .ts (Node
// refuses type stripping under node_modules), the server does not come
// up, smoke fails, or any bench phase errors.
// Run: pnpm verify:pack
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const work = mkdtempSync(path.join(tmpdir(), 'boring-cms-verify-'));
const port = 3000 + Math.floor(Math.random() * 2000);
let server;
let failed = false;

function fail(msg) {
  console.error(`verify-pack: FAIL: ${msg}`);
  failed = true;
}

try {
  execSync(`npm pack --pack-destination ${work}`, { cwd: repo, stdio: 'pipe' });
  const tarball = path.join(work, readdirSync(work).find((f) => f.endsWith('.tgz')));

  const listing = execSync(`tar -tzf ${tarball}`).toString();
  const tsFiles = listing.split('\n').filter((f) => f.endsWith('.ts'));
  if (tsFiles.length > 0) fail(`tarball ships .ts files (broken under npx): ${tsFiles.join(', ')}`);
  if (!listing.includes('package/server.js')) fail('tarball missing server.js (prepack emit failed)');

  const appDir = path.join(work, 'app');
  mkdirSync(appDir, { recursive: true });
  execSync(`npm install --no-fund --no-audit ${tarball}`, { cwd: appDir, stdio: 'pipe' });

  server = spawn(path.join(appDir, 'node_modules/.bin/boring-cms'), [], {
    cwd: appDir,
    env: { ...process.env, HOME: path.join(work, 'home'), BORING_CMS_HOME: '', PORT: String(port) },
    stdio: 'ignore',
  });

  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`http://localhost:${port}/admin/login`, { redirect: 'manual' })
      .then((r) => r.status === 200 || r.status === 302)
      .catch(() => false);
  }
  if (!up) fail(`packaged server did not answer on port ${port} within 15s`);

  if (!failed) {
    console.log('verify-pack: packaged server up, running smoke suite');
    execSync('node scripts/smoke.ts', { cwd: repo, stdio: 'inherit' });

    console.log('verify-pack: running benchmark against the packaged server');
    const benchOut = path.join(work, 'bench.json');
    execSync(
      `node bench/bench.mjs --base http://localhost:${port} --out ${benchOut} --label verify-pack`,
      { cwd: repo, stdio: 'inherit' },
    );
  }
} catch (err) {
  fail(err.message);
} finally {
  if (server) server.kill();
  rmSync(work, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log('verify-pack: packaged tarball boots and answers. Safe to publish.');
