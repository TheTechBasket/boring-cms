// Boots the app on a random port with a temp data directory, then walks
// through: setup -> login -> create project -> set an encrypted setting ->
// read it back -> delete the project. Asserts each step with plain assert.
// Exit 0 on success.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { createApp } from '../server.js';
import { openCoreDb } from '../lib/db.js';
import { getProjectBySlug, getSettingValue } from '../lib/store.js';

const dataDir = mkdtempSync(path.join(tmpdir(), 'yncms-smoke-'));
const masterKey = randomBytes(32).toString('hex');

const app = createApp({ dataDir, masterKey, port: 0 });

await new Promise((resolve) => app.listen(0, resolve));
const port = app.address().port;
const base = `http://127.0.0.1:${port}`;

let cookie = null;

function withCookie(headers = {}) {
  return cookie ? { ...headers, Cookie: cookie } : headers;
}

function captureCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }
}

async function req(method, urlPath, { form } = {}) {
  const init = {
    method,
    redirect: 'manual',
    headers: withCookie(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
  };
  if (form) init.body = new URLSearchParams(form).toString();
  const res = await fetch(base + urlPath, init);
  captureCookie(res);
  return res;
}

async function main() {
  // 1. First-run redirect to /setup
  const home = await req('GET', '/');
  assert.equal(home.status, 302, 'GET / should redirect while no admin exists');
  assert.equal(home.headers.get('location'), '/setup');

  const setupPage = await req('GET', '/setup');
  assert.equal(setupPage.status, 200, 'GET /setup should render');

  // 2. Create the admin account
  const email = 'admin@example.com';
  const password = 'correct horse battery staple';
  const setupRes = await req('POST', '/setup', {
    form: { email, password, password_confirm: password },
  });
  assert.equal(setupRes.status, 302, 'setup should redirect on success');
  assert.ok(cookie, 'setup should set a session cookie');

  const projectsAfterSetup = await req('GET', '/admin/projects');
  assert.equal(projectsAfterSetup.status, 200, 'should be logged in after setup');

  // 3. Log out, log back in
  await req('POST', '/logout');
  const loginPage = await req('GET', '/login');
  assert.equal(loginPage.status, 200);

  const loginRes = await req('POST', '/login', { form: { email, password } });
  assert.equal(loginRes.status, 302, 'login should succeed and redirect');
  assert.equal(loginRes.headers.get('location'), '/admin/projects');

  // 4. Create a project
  const slug = 'demo-project';
  const createRes = await req('POST', '/admin/projects', {
    form: { name: 'Demo Project', slug },
  });
  assert.equal(createRes.status, 302, 'creating a project should redirect');

  const projectDbPath = path.join(dataDir, 'projects', `${slug}.db`);
  assert.ok(existsSync(projectDbPath), 'project DB file should exist after creation');

  // 5. Set an encrypted setting on the project
  const settingKey = 'api_token';
  const settingValue = 'super-secret-value-12345';
  const settingRes = await req('POST', `/admin/projects/${slug}/settings`, {
    form: { key: settingKey, value: settingValue },
  });
  assert.equal(settingRes.status, 302, 'saving a setting should redirect');

  const detailPage = await req('GET', `/admin/projects/${slug}`);
  const detailHtml = await detailPage.text();
  assert.ok(detailHtml.includes(settingKey), 'settings list should show the key');
  assert.ok(!detailHtml.includes(settingValue), 'settings list must never echo the value');

  // 6. Read the setting back, decrypted, straight from core.db (internal
  // check -- the admin UI itself never echoes secret values).
  const project = getProjectBySlug(app.coreDb, slug);
  assert.ok(project, 'project row should exist in core.db');
  const decrypted = getSettingValue(app.coreDb, masterKey, {
    scope: 'project',
    projectId: project.id,
    key: settingKey,
  });
  assert.equal(decrypted, settingValue, 'decrypted setting should round-trip');

  // 7. Delete the project (requires exact slug confirmation)
  const badDelete = await req('POST', `/admin/projects/${slug}/delete`, {
    form: { confirm: 'not-the-slug' },
  });
  assert.equal(badDelete.status, 400, 'delete without exact confirm should be rejected');
  assert.ok(existsSync(projectDbPath), 'project DB should still exist after rejected delete');

  const deleteRes = await req('POST', `/admin/projects/${slug}/delete`, {
    form: { confirm: slug },
  });
  assert.equal(deleteRes.status, 302, 'confirmed delete should redirect');
  assert.ok(!existsSync(projectDbPath), 'project DB file should be gone after delete');
  assert.equal(getProjectBySlug(app.coreDb, slug), null, 'project row should be gone from core.db');

  console.log('smoke: all assertions passed');
}

try {
  await main();
  process.exitCode = 0;
} catch (err) {
  console.error('smoke: FAILED');
  console.error(err);
  process.exitCode = 1;
} finally {
  app.closeAll();
  await new Promise((resolve) => app.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
}
