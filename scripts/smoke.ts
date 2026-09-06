// Boots the app on a random port with a temp data directory, then walks
// through: setup -> login -> create project -> set an encrypted setting ->
// read it back -> delete the project. Asserts each step with plain assert.
// Exit 0 on success.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { createApp } from '../server.ts';
import { openCoreDb } from '../lib/db.ts';
import { getProjectBySlug, getSettingValue } from '../lib/store.ts';
import { getCollection, getEntry, listRevisions } from '../lib/content.ts';

const dataDir = mkdtempSync(path.join(tmpdir(), 'yncms-smoke-'));
const masterKey = randomBytes(32).toString('hex');

const app: any = createApp({ dataDir, masterKey, port: 0 });

await new Promise<void>((resolve) => app.listen(0, () => resolve()));
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

async function req(method, urlPath, { form }: { form?: Record<string, string> } = {}) {
  const init: any = {
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

  // 7. Content: collection with auto slug, markdown field, entry
  const collRes = await req('POST', `/admin/projects/${slug}/collections`, {
    form: { name: 'Blog Posts' },
  });
  assert.equal(collRes.status, 302, 'creating a collection should redirect');
  assert.equal(collRes.headers.get('location'), `/admin/projects/${slug}/collections/blog-posts`, 'collection slug should be auto-generated');

  const fieldRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/add`, {
    form: { label: 'Body', type: 'markdown' },
  });
  assert.equal(fieldRes.status, 302, 'adding a field should redirect');

  const entryRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/new`, {
    form: { title: 'Hello World', field_body: '# First draft' },
  });
  assert.equal(entryRes.status, 302, 'creating an entry should redirect');
  assert.equal(entryRes.headers.get('location'), `/admin/projects/${slug}/collections/blog-posts/hello-world`, 'entry slug should be auto-generated');

  // 8. Edit -> revision with backward delta of only the changed field
  const editRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/hello-world`, {
    form: { title: 'Hello World', field_body: '# Second draft' },
  });
  assert.equal(editRes.status, 302, 'editing an entry should redirect');

  const projectDb = app.projectDbs.get(slug);
  const collection = getCollection(projectDb, 'blog-posts');
  let entry = getEntry(projectDb, collection.id, 'hello-world');
  assert.equal(entry.data.body, '# Second draft', 'edit should persist');
  const revisions = listRevisions(projectDb, entry.id);
  assert.equal(revisions.length, 1, 'edit should create one revision');
  assert.deepEqual(revisions[0].changed, { body: '# First draft' }, 'revision should hold only the previous value of the changed field');

  // 9. Publish, then read through the public API with a Bearer key
  const publishRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/hello-world/publish`);
  assert.equal(publishRes.status, 302, 'publish should redirect');

  const keyPage = await req('POST', `/admin/projects/${slug}/api-keys`, { form: { name: 'smoke' } });
  assert.equal(keyPage.status, 200, 'creating an API key should render the key once');
  const keyHtml = await keyPage.text();
  const apiKey = (keyHtml.match(/yn_[A-Za-z0-9_-]+/) || [])[0];
  assert.ok(apiKey, 'created API key should appear in the page');

  const noAuth = await fetch(`${base}/api/v1/${slug}/blog-posts`);
  assert.equal(noAuth.status, 401, 'API without a key should be 401');

  const authed = await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(authed.status, 200, 'API with a key should be 200');
  const etag = authed.headers.get('etag');
  assert.ok(etag, 'API response should carry an ETag');
  const list: any = await authed.json();
  assert.equal(list.items.length, 1, 'published list should have one item');
  assert.equal(list.items[0].slug, 'hello-world');
  assert.equal(list.items[0].body, '# Second draft', 'published snapshot should carry the field value');

  const single = await fetch(`${base}/api/v1/${slug}/blog-posts/hello-world`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(((await single.json()) as any).title, 'Hello World');

  const cached = await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}`, 'If-None-Match': etag } });
  assert.equal(cached.status, 304, 'matching If-None-Match should be a 304');

  // 10. Atomic revert to the first revision
  const revertRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/hello-world/revert`, {
    form: { revision_id: String(revisions[0].id) },
  });
  assert.equal(revertRes.status, 302, 'revert should redirect');
  entry = getEntry(projectDb, collection.id, 'hello-world');
  assert.equal(entry.data.body, '# First draft', 'revert should restore the previous field value');

  // 11. Delete the project (requires exact slug confirmation)
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
