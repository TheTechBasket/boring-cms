// Boots the app on a random port with a temp data directory, then walks
// through: setup -> login -> create project -> set an encrypted setting ->
// read it back -> delete the project. Asserts each step with plain assert.
// Exit 0 on success.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import http from 'node:http';

import { createApp } from '../server.ts';
import { openCoreDb } from '../lib/db.ts';
import { getProjectBySlug, getSettingValue, getUserByEmail, createSession } from '../lib/store.ts';
import { signValue } from '../lib/crypto.ts';
import { getCollection, getEntry, listRevisions } from '../lib/content.ts';
import { toolCatalog } from '../lib/mcp.ts';

let webhookServer: any = null;

const dataDir = mkdtempSync(path.join(tmpdir(), 'boring-cms-smoke-'));
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
  let password = 'correct horse battery staple';
  const setupRes = await req('POST', '/setup', {
    form: { email, password, password_confirm: password },
  });
  assert.equal(setupRes.status, 302, 'setup should redirect on success');
  assert.ok(cookie, 'setup should set a session cookie');

  const projectsAfterSetup = await req('GET', '/admin/projects');
  assert.equal(projectsAfterSetup.status, 200, 'should be logged in after setup');

  // 2b. Login rate limit: per-IP bucket checked before the password hash.
  await req('POST', '/logout');
  cookie = null;
  for (let i = 0; i < 10; i++) {
    const res = await req('POST', '/login', { form: { email, password: 'wrong-password' } });
    assert.equal(res.status, 401, `failed login attempt ${i + 1} should stay 401`);
  }
  const loginLimited = await req('POST', '/login', { form: { email, password: 'wrong-password' } });
  assert.equal(loginLimited.status, 429, '11th login attempt from the same IP should be rate limited');
  assert.ok((await loginLimited.text()).includes('Too many attempts'), 'rate limit page should explain the block');
  const blockedGood = await req('POST', '/login', { form: { email, password } });
  assert.equal(blockedGood.status, 429, 'correct password should also be blocked while rate limited');
  await new Promise((r) => setTimeout(r, 6500));

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

  // Field reorder: add a second field, move it first, assert the order.
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/add`, {
    form: { label: 'Subtitle', type: 'text' },
  });
  const reorderRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/reorder`, {
    form: { order: 'subtitle,body' },
  });
  assert.equal(reorderRes.status, 302, 'reorder should redirect');

  // Field options: constrain subtitle, reject a violating entry, then clear.
  const updateFieldRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/update`, {
    form: { field: 'subtitle', label: 'Subtitle', type: 'text', required: '1', maxlength: '10', help: 'Keep it short' },
  });
  assert.equal(updateFieldRes.status, 302, 'field update should redirect');

  const badEntryRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/new`, {
    form: { field_subtitle: 'way past the ten character limit', field_body: 'x' },
  });
  assert.equal(badEntryRes.status, 400, 'entry violating field options should be rejected');
  assert.ok((await badEntryRes.text()).includes('at most 10'), 'rejection should name the violated limit');

  const missingRequiredRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/new`, {
    form: { field_subtitle: '', field_body: 'x' },
  });
  assert.equal(missingRequiredRes.status, 400, 'missing required field should be rejected');

  // Clear the constraints (blank form values remove stored options).
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/update`, {
    form: { field: 'subtitle', label: 'Subtitle', type: 'text', maxlength: '', help: '' },
  });

  // Image field type accepts a URL string.
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/add`, {
    form: { label: 'Cover', type: 'image' },
  });

  const entryRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/new`, {
    form: { field_body: '# First draft', field_cover: `/media/${slug}/abc123-pic.png` },
  });
  assert.equal(entryRes.status, 302, 'creating an entry should redirect');
  const entrySlug = (entryRes.headers.get('location') || '').split('/').pop() as string;
  assert.match(entrySlug, /^[0-9a-f-]{36}$/, 'entry slug should be a UUID');

  // 8. Edit -> revision with backward delta of only the changed field
  const editRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}`, {
    form: { field_body: '# Second draft', field_cover: `/media/${slug}/abc123-pic.png` },
  });
  assert.equal(editRes.status, 302, 'editing an entry should redirect');

  const projectDb = app.projectDbs.get(slug);
  const collection = getCollection(projectDb, 'blog-posts');
  assert.deepEqual(collection.fields.map((f) => f.name), ['subtitle', 'body', 'cover'], 'reorder should persist field order');

  // Reserved names (system API fields) never mint as user field names.
  const reservedRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/add`, { form: { label: 'Slug', type: 'text' } });
  assert.equal(reservedRes.status, 302, 'adding a reserved-labeled field should still redirect');
  const withReserved = getCollection(projectDb, 'blog-posts');
  assert.ok(!withReserved.fields.some((f) => f.name === 'slug'), 'a field labeled Slug should not take the reserved name');
  assert.ok(withReserved.fields.some((f) => f.name === 'slug-2'), 'reserved label should mint a suffixed name');
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/remove`, { form: { field: 'slug-2' } });

  // Explicit field id wins over the label-derived one.
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/add`, { form: { label: 'Body Copy', type: 'text', name: 'content' } });
  const withCustomId = getCollection(projectDb, 'blog-posts');
  assert.ok(withCustomId.fields.some((f) => f.name === 'content' && f.label === 'Body Copy'), 'explicit field id should become the data key');
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/remove`, { form: { field: 'content' } });

  // Collection page lists the built-in system fields.
  const collPageHtml = await (await req('GET', `/admin/projects/${slug}/collections/blog-posts`)).text();
  assert.ok(collPageHtml.includes('built-in'), 'fields editor should show built-in system field rows');
  const subtitleField = collection.fields[0];
  assert.equal(subtitleField.maxlength, undefined, 'blank option value should clear the stored constraint');
  assert.equal(subtitleField.required, undefined, 'unchecked required should clear the flag');
  let entry0 = getEntry(projectDb, collection.id, entrySlug);
  assert.equal(entry0.data.cover, `/media/${slug}/abc123-pic.png`, 'image field should store the URL string');
  let entry = getEntry(projectDb, collection.id, entrySlug);
  assert.equal(entry.data.body, '# Second draft', 'edit should persist');
  const revisions = listRevisions(projectDb, entry.id);
  assert.equal(revisions.length, 1, 'edit should create one revision');
  assert.deepEqual(revisions[0].changed, { body: '# First draft' }, 'revision should hold only the previous value of the changed field');

  // Per-collection revisions off: edits stop recording, turning it back on records again.
  const cover = `/media/${slug}/abc123-pic.png`;
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/revisions`, { form: { revisions_keep: '0' } });
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}`, { form: { field_body: '# Third draft', field_cover: cover } });
  assert.equal(listRevisions(projectDb, entry.id).length, 1, 'revisions off should record no new revision');
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/revisions`, { form: { revisions_keep: '' } });
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}`, { form: { field_body: '# Second draft', field_cover: cover } });
  assert.equal(listRevisions(projectDb, entry.id).length, 2, 'default retention should record revisions again');

  // Native entry slug is editable from the editor form (rename, then rename back).
  const editorHtml = await (await req('GET', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}`)).text();
  assert.ok(editorHtml.includes('name="entry_slug"'), 'entry editor should expose the slug as a field');
  const renameRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}`, { form: { field_body: '# Second draft', field_cover: cover, entry_slug: 'smoke-renamed' } });
  assert.equal(renameRes.status, 302, 'rename should redirect');
  assert.ok((renameRes.headers.get('location') || '').endsWith('/smoke-renamed'), 'redirect should follow the new slug');
  assert.ok(getEntry(projectDb, collection.id, 'smoke-renamed'), 'entry should be reachable under the new slug');
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/smoke-renamed`, { form: { field_body: '# Second draft', field_cover: cover, entry_slug: entrySlug } });
  assert.ok(getEntry(projectDb, collection.id, entrySlug), 'entry should be back under the original slug');

  // 9. Webhook setup and publish, then read through the public API with a Bearer key
  const webhookEvents: Array<{ headers: http.IncomingHttpHeaders; body: any; rawBody: string }> = [];
  webhookServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      let body: any = null;
      try { body = JSON.parse(rawBody); } catch {}
      webhookEvents.push({ headers: req.headers, body, rawBody });
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise<void>((resolve) => webhookServer.listen(0, '127.0.0.1', () => resolve()));
  const webhookPort = (webhookServer.address() as any).port;
  const webhookUrl = `http://127.0.0.1:${webhookPort}/webhook`;
  const webhookSecret = 'smoke-secret-key-123';

  // Bad webhook URL should be rejected with 400
  const badWebhookRes = await req('POST', `/admin/projects/${slug}/webhook`, {
    form: { webhook_url: 'not-a-valid-url' },
  });
  assert.equal(badWebhookRes.status, 400, 'invalid webhook url should return 400');

  // Set webhook_url and webhook_secret via settings form POST
  const setWebhookRes = await req('POST', `/admin/projects/${slug}/settings`, {
    form: { webhook_url: webhookUrl, webhook_secret: webhookSecret },
  });
  assert.equal(setWebhookRes.status, 302, 'saving webhook settings should redirect');

  const settingsPageHtml = await (await req('GET', `/admin/projects/${slug}`)).text();
  assert.ok(settingsPageHtml.includes(webhookUrl), 'settings page should pre-fill webhook_url');
  assert.ok(!settingsPageHtml.includes(webhookSecret), 'settings page must never reveal webhook_secret');

  async function waitForWebhook(predicate: (e: any) => boolean, timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = webhookEvents.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 20));
    }
    return null;
  }

  const publishRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}/publish`);
  assert.equal(publishRes.status, 302, 'publish should redirect');

  const pubEvent = await waitForWebhook((e) => e.body?.event === 'entry.publish');
  assert.ok(pubEvent, 'webhook listener should receive entry.publish event within 2s');
  assert.equal(pubEvent.body.project, slug);
  assert.equal(pubEvent.body.collection, 'blog-posts');
  assert.equal(pubEvent.body.slug, entrySlug);
  assert.ok(pubEvent.body.at, 'payload should contain an ISO timestamp');
  assert.equal(pubEvent.headers['user-agent'], 'boring-cms-webhook');
  assert.equal(pubEvent.headers['content-type'], 'application/json');

  const expectedSig = 'sha256=' + createHmac('sha256', webhookSecret).update(pubEvent.rawBody).digest('hex');
  assert.equal(pubEvent.headers['x-boring-signature'], expectedSig, 'webhook signature header should match computed HMAC');

  // Unpublish and assert entry.unpublish arrives
  const unpublishRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}/unpublish`);
  assert.equal(unpublishRes.status, 302, 'unpublish should redirect');

  const unpubEvent = await waitForWebhook((e) => e.body?.event === 'entry.unpublish');
  assert.ok(unpubEvent, 'webhook listener should receive entry.unpublish event within 2s');
  assert.equal(unpubEvent.body.project, slug);
  assert.equal(unpubEvent.body.collection, 'blog-posts');
  assert.equal(unpubEvent.body.slug, entrySlug);

  // Delete of a draft entry must NOT fire entry.delete
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/new`, { form: { field_body: 'draft to delete', entry_slug: 'draft-del' } });
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/draft-del/delete`);
  const draftDelEvent = await waitForWebhook((e) => e.body?.event === 'entry.delete' && e.body?.slug === 'draft-del', 200);
  assert.equal(draftDelEvent, null, 'deleting a draft entry must not fire a webhook');

  // Delete of a published entry MUST fire entry.delete
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/new`, { form: { field_body: 'pub to delete', entry_slug: 'pub-del' } });
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/pub-del/publish`);
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/pub-del/delete`);
  const pubDelEvent = await waitForWebhook((e) => e.body?.event === 'entry.delete' && e.body?.slug === 'pub-del');
  assert.ok(pubDelEvent, 'deleting a published entry must fire entry.delete');
  assert.equal(pubDelEvent.body.slug, 'pub-del');

  // Re-publish so subsequent tests continue with a published entry
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}/publish`);

  // Blank secret keeps existing secret
  await req('POST', `/admin/projects/${slug}/webhook`, {
    form: { webhook_url: webhookUrl, webhook_secret: '' },
  });
  const projectRow = getProjectBySlug(app.coreDb, slug);
  const keptSecret = getSettingValue(app.coreDb, masterKey, { scope: 'project', projectId: projectRow.id, key: 'webhook_secret' });
  assert.equal(keptSecret, webhookSecret, 'blank secret should keep existing secret');

  // Blank webhook_url clears the setting
  await req('POST', `/admin/projects/${slug}/webhook`, {
    form: { webhook_url: '', webhook_secret: '' },
  });
  const clearedUrl = getSettingValue(app.coreDb, masterKey, { scope: 'project', projectId: projectRow.id, key: 'webhook_url' });
  assert.equal(clearedUrl, null, 'blank webhook_url should clear the setting');

  // Restore webhook config for remaining tests
  await req('POST', `/admin/projects/${slug}/webhook`, {
    form: { webhook_url: webhookUrl, webhook_secret: webhookSecret },
  });

  const keyPage = await req('POST', `/admin/projects/${slug}/api-keys`, { form: { name: 'smoke', mcp: '1' } });
  assert.equal(keyPage.status, 200, 'creating an API key should render the key once');
  const keyHtml = await keyPage.text();
  const apiKey = (keyHtml.match(/yn_[A-Za-z0-9_-]+/) || [])[0];
  assert.ok(apiKey, 'created API key should appear in the page');
  assert.ok(keyHtml.includes('REST API'), 'API keys page should carry the REST API docs card');
  assert.ok(keyHtml.includes(`/api/v1/${slug}/blog-posts`), 'API docs should list live per-collection URLs');

  const noAuth = await fetch(`${base}/api/v1/${slug}/blog-posts`);
  assert.equal(noAuth.status, 401, 'API without a key should be 401');

  const authed = await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(authed.status, 200, 'API with a key should be 200');
  const etag = authed.headers.get('etag');
  assert.ok(etag, 'API response should carry an ETag');
  const list: any = await authed.json();
  assert.equal(list.items.length, 1, 'published list should have one item');
  assert.equal(list.items[0].slug, entrySlug);
  assert.equal(list.items[0].body, '# Second draft', 'published snapshot should carry the field value');

  const single = await fetch(`${base}/api/v1/${slug}/blog-posts/${entrySlug}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(((await single.json()) as any).body, '# Second draft');

  const cached = await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}`, 'If-None-Match': etag } });
  assert.equal(cached.status, 304, 'matching If-None-Match should be a 304');

  const sinceOld = await fetch(`${base}/api/v1/${slug}/blog-posts?updated_since=2000-01-01T00:00:00Z`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(((await sinceOld.json()) as any).items.length, 1, 'old updated_since should return the entry');
  const sinceFuture = await fetch(`${base}/api/v1/${slug}/blog-posts?updated_since=2099-01-01T00:00:00Z`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(((await sinceFuture.json()) as any).items.length, 0, 'future updated_since should return nothing');
  const sinceBad = await fetch(`${base}/api/v1/${slug}/blog-posts?updated_since=not-a-date`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(sinceBad.status, 400, 'invalid updated_since should be 400');

  // Bare ISO without a zone is UTC, same as an explicit Z suffix.
  const sinceBare = await fetch(`${base}/api/v1/${slug}/blog-posts?updated_since=2000-01-01T00:00:00`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const sinceZulu = await fetch(`${base}/api/v1/${slug}/blog-posts?updated_since=2000-01-01T00:00:00Z`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(((await sinceBare.json()) as any).items.length, ((await sinceZulu.json()) as any).items.length, 'bare ISO updated_since should match Zulu form');
  const rowClock = projectDb.prepare('SELECT updated_at FROM entries WHERE slug = ?').get(entrySlug).updated_at as string;
  const cursorBare = rowClock.replace(' ', 'T');
  const cursorZulu = `${cursorBare}Z`;
  const sinceExactBare = await fetch(`${base}/api/v1/${slug}/blog-posts?updated_since=${encodeURIComponent(cursorBare)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const sinceExactZulu = await fetch(`${base}/api/v1/${slug}/blog-posts?updated_since=${encodeURIComponent(cursorZulu)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(((await sinceExactBare.json()) as any).items.length, ((await sinceExactZulu.json()) as any).items.length, 'entry updated_at cursor should not shift with bare ISO');

  // limit/offset are clamped: negatives cannot become LIMIT -5 or a negative OFFSET.
  const clamped = await fetch(`${base}/api/v1/${slug}/blog-posts?limit=-5&offset=-10`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(clamped.status, 200, 'negative limit/offset should not error');
  assert.equal(((await clamped.json()) as any).items.length, 1, 'clamped limit 1 still returns the single entry');
  const hugeLimit = await fetch(`${base}/api/v1/${slug}/blog-posts?limit=999999`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(((await hugeLimit.json()) as any).items.length, 1, 'huge limit should clamp to available rows');
  const badLimit = await fetch(`${base}/api/v1/${slug}/blog-posts?limit=abc`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(((await badLimit.json()) as any).items.length, 1, 'non-numeric limit should fall back and still return rows');

  // 9b. Headless media upload: Bearer key, write scope, {id, key, url} back
  const upKeyPage = await req('POST', `/admin/projects/${slug}/api-keys`, { form: { name: 'smoke-write', scope: 'write', mcp: '1' } });
  const upWriteKey = ((await upKeyPage.text()).match(/yn_[A-Za-z0-9_-]+/) || [])[0];
  assert.ok(upWriteKey, 'write-scope API key should appear once');

  // 9a-2. Project export + restore round-trip (backup / disaster recovery).
  const dump: any = await (await fetch(`${base}/api/v1/${slug}/export`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
  assert.ok(dump.schema && Array.isArray(dump.collections), 'export dump carries schema + collections');
  assert.equal((await fetch(`${base}/api/v1/${slug}/export`)).status, 401, 'export requires a key');
  const importReadKey = await fetch(`${base}/api/v1/${slug}/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(importReadKey.status, 403, 'import needs a write-scope key');
  const restore = await fetch(`${base}/api/v1/${slug}/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${upWriteKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(dump),
  });
  assert.equal(restore.status, 200, 'restoring own dump should succeed');
  const restoreReport: any = await restore.json();
  assert.equal(restoreReport.collections['blog-posts'].created, 0, 'restoring own dump creates nothing (idempotent upsert)');

  // 9a. A key created without MCP access is refused at the /mcp endpoint.
  const noMcpPage = await req('POST', `/admin/projects/${slug}/api-keys`, { form: { name: 'smoke-nomcp' } });
  const noMcpKey = ((await noMcpPage.text()).match(/yn_[A-Za-z0-9_-]+/) || [])[0];
  const noMcpRes = await fetch(`${base}/mcp/${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${noMcpKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(noMcpRes.status, 403, 'a key without MCP access should be 403 at /mcp');

  const apiUploadBody = (name: string) =>
    `--smokeapib\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: text/plain\r\n\r\napi upload\r\n--smokeapib--\r\n`;
  const apiUploadHeaders = (key?: string) => ({
    'Content-Type': 'multipart/form-data; boundary=smokeapib',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  });

  const upNoAuth = await fetch(`${base}/api/v1/${slug}/media`, { method: 'POST', headers: apiUploadHeaders(), body: apiUploadBody('a.txt') });
  assert.equal(upNoAuth.status, 401, 'API upload without a key should be 401');
  const upReadKey = await fetch(`${base}/api/v1/${slug}/media`, { method: 'POST', headers: apiUploadHeaders(apiKey), body: apiUploadBody('a.txt') });
  assert.equal(upReadKey.status, 403, 'API upload with a read key should be 403');

  const upOk = await fetch(`${base}/api/v1/${slug}/media`, { method: 'POST', headers: apiUploadHeaders(upWriteKey), body: apiUploadBody('api-note.txt') });
  assert.equal(upOk.status, 200, 'API upload with a write key should be 200');
  const upJson: any = await upOk.json();
  assert.ok(upJson.id && upJson.key.endsWith('-api-note.txt'), 'API upload should return id and key');
  assert.equal(upJson.url, `/media/${slug}/${upJson.key}`, 'API upload should return the full URL (app route on local disk)');
  const upServed = await fetch(`${base}${upJson.url}`);
  assert.equal(await upServed.text(), 'api upload', 'API-uploaded bytes should serve back');

  const upNested =
    `--smokeapib\r\nContent-Disposition: form-data; name="path"\r\n\r\nwp-content/uploads/2026/09\r\n${apiUploadBody('b.txt')}`;
  const upNestedRes = await fetch(`${base}/api/v1/${slug}/media`, { method: 'POST', headers: apiUploadHeaders(upWriteKey), body: upNested });
  assert.equal(upNestedRes.status, 400, 'folder path on a storage without a public base should be 400');

  // MCP upload_media: same auth model, base64 body, full URL back
  const mcpUpload = await fetch(`${base}/mcp/${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${upWriteKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'upload_media', arguments: { filename: 'mcp-note.txt', data_base64: Buffer.from('mcp upload').toString('base64') } },
    }),
  });
  const mcpUploadJson: any = await mcpUpload.json();
  assert.ok(!mcpUploadJson.result.isError, 'MCP upload_media should succeed');
  const mcpMedia = JSON.parse(mcpUploadJson.result.content[0].text);
  assert.ok(mcpMedia.url.endsWith('-mcp-note.txt'), 'MCP upload should return the media URL');
  const mcpReadOnly = await fetch(`${base}/mcp/${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'upload_media', arguments: { filename: 'x.txt', data_base64: 'aGk=' } },
    }),
  });
  const mcpReadOnlyJson: any = await mcpReadOnly.json();
  assert.ok(mcpReadOnlyJson.error, 'read-only key should be rejected for upload_media');

  // 9c. Schema over the API: introspection, MCP schema tools, REST apply
  const mcpTool = async (key: string, name: string, args: any = {}) => {
    const r = await fetch(`${base}/mcp/${slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return ((await r.json()) as any).result;
  };

  const fieldTypesRes = await fetch(`${base}/api/v1/${slug}/field-types`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const typesJson: any = await fieldTypesRes.json();
  assert.ok(typesJson.types.relation.options.collection, 'field-types should carry relation-specific options');
  assert.ok(typesJson.reserved_field_names.includes('slug'), 'field-types should list reserved names');

  const specRes = await fetch(`${base}/api/v1/${slug}/openapi.json`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(specRes.status, 200, 'openapi.json should serve with a key');
  const spec: any = await specRes.json();
  assert.equal(spec.openapi, '3.1.0');
  for (const t of toolCatalog) assert.ok(spec.paths[`/api/v1/${slug}/call/${t.name}`]?.post, `spec should cover tool ${t.name}`);
  for (const p of [`/mcp/${slug}`, `/api/v1/${slug}/{collection}`, `/api/v1/${slug}/{collection}/{entry}/counters/{field}`]) assert.ok(spec.paths[p], `spec should cover ${p}`);
  assert.equal((await fetch(`${base}/api/v1/${slug}/openapi.json`)).status, 401, 'openapi.json should need a key');

  const schemaReadRes = await fetch(`${base}/api/v1/${slug}/schema`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.ok(((await schemaReadRes.json()) as any).collections.some((c: any) => c.slug === 'blog-posts'), 'schema read should list blog-posts');

  const createdCol = JSON.parse((await mcpTool(upWriteKey, 'create_collection', { name: 'Authors' })).content[0].text);
  assert.equal(createdCol.slug, 'authors', 'create_collection should derive the slug');
  const addedField = JSON.parse((await mcpTool(upWriteKey, 'add_field', { collection: 'authors', label: 'Bio', type: 'markdown', options: { maxlength: 500 } })).content[0].text);
  assert.equal(addedField.maxlength, 500, 'add_field should store options');
  const badOpt = await mcpTool(upWriteKey, 'add_field', { collection: 'authors', label: 'Age', type: 'number', options: { pattern: 'x' } });
  assert.ok(badOpt.isError, 'an option invalid for the type should be rejected');
  const updatedField = JSON.parse((await mcpTool(upWriteKey, 'update_field', { collection: 'authors', field: 'bio', required: true, options: { help: 'Short bio' } })).content[0].text);
  assert.ok(updatedField.required === true && updatedField.help === 'Short bio' && updatedField.maxlength === 500, 'update_field should merge options');
  const removedField = JSON.parse((await mcpTool(upWriteKey, 'remove_field', { collection: 'authors', field: 'bio' })).content[0].text);
  assert.equal(removedField.fields.length, 0, 'remove_field should drop the field');

  const applyDenied = await fetch(`${base}/api/v1/${slug}/schema`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ collections: [] }),
  });
  assert.equal(applyDenied.status, 403, 'REST schema apply with a read key should be 403');
  const schemaApplyRes = await fetch(`${base}/api/v1/${slug}/schema`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${upWriteKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ collections: [{ slug: 'authors', name: 'Writers', fields: [{ name: 'bio', label: 'Bio', type: 'markdown' }] }] }),
  });
  const applyJson: any = await schemaApplyRes.json();
  assert.ok(applyJson.updated.includes('authors'), 'REST apply should update the collection by slug');
  assert.ok(applyJson.missing.includes('blog-posts'), 'REST apply without delete_missing should only report absent collections');
  const mcpSchema = JSON.parse((await mcpTool(apiKey, 'get_schema')).content[0].text);
  assert.ok(mcpSchema.collections.some((c: any) => c.slug === 'authors' && c.name === 'Writers'), 'get_schema should reflect the applied change');

  // 9c-2. Schema impact guard: a required field add/update that would break
  // existing entries is blocked with a reason unless force: true is passed;
  // content_version bumps on the write; removed fields archive (not delete)
  // and can be restored; check_schema_health reports live drift.
  {
    const versionBefore = (await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}` } })).headers.get('etag');

    const blockedAdd = await mcpTool(upWriteKey, 'add_field', { collection: 'blog-posts', label: 'Category', type: 'text', required: true });
    assert.ok(blockedAdd.isError, 'required field add on a collection with entries should be blocked without force');
    assert.ok(blockedAdd.content[0].text.includes('Retry with force: true'), 'blocked add should mention the force retry');

    const forcedAdd = JSON.parse((await mcpTool(upWriteKey, 'add_field', { collection: 'blog-posts', label: 'Category', type: 'text', required: true, force: true })).content[0].text);
    assert.equal(forcedAdd.required, true, 'forced add should apply despite existing entries failing validation');

    const versionAfterAdd = (await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}` } })).headers.get('etag');
    assert.notEqual(versionAfterAdd, versionBefore, 'content_version (ETag) should bump on a schema field add');

    const blockedUpdate = await mcpTool(upWriteKey, 'update_field', { collection: 'blog-posts', field: 'category', type: 'number' });
    assert.ok(blockedUpdate.isError, 'a field update that still breaks existing entries should be blocked without force');
    const forcedUpdate = JSON.parse((await mcpTool(upWriteKey, 'update_field', { collection: 'blog-posts', field: 'category', type: 'number', force: true })).content[0].text);
    assert.equal(forcedUpdate.type, 'number', 'forced update should apply despite existing entries failing validation');

    const versionBeforeRemove = (await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}` } })).headers.get('etag');
    const removedCategory = JSON.parse((await mcpTool(upWriteKey, 'remove_field', { collection: 'blog-posts', field: 'category' })).content[0].text);
    assert.ok(!removedCategory.fields.some((f: any) => f.name === 'category'), 'remove_field should drop category from active fields');
    const versionAfterRemove = (await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}` } })).headers.get('etag');
    assert.notEqual(versionAfterRemove, versionBeforeRemove, 'content_version should bump on field removal');

    const archivedPageHtml = await (await req('GET', `/admin/projects/${slug}/collections/blog-posts`)).text();
    assert.ok(archivedPageHtml.includes('Archived fields'), 'collection page should list archived fields after a removal');

    const restoreDenied = await mcpTool(upWriteKey, 'restore_field', { collection: 'blog-posts', field: 'no-such-field' });
    assert.ok(restoreDenied.isError, 'restoring a non-archived field name should be rejected');

    // category archived as required; entries have no value for it, so
    // restoring it is blocked the same way add/update are, unless forced.
    const restoreBlocked = await mcpTool(upWriteKey, 'restore_field', { collection: 'blog-posts', field: 'category' });
    assert.ok(restoreBlocked.isError, 'restoring a required field that existing entries would fail should be blocked without force');
    const restored = JSON.parse((await mcpTool(upWriteKey, 'restore_field', { collection: 'blog-posts', field: 'category', force: true })).content[0].text);
    assert.equal(restored.name, 'category', 'forced restore_field should bring the archived field back');
    assert.equal(restored.type, 'number', 'restored field should keep its last saved definition');

    const health = JSON.parse((await mcpTool(apiKey, 'check_schema_health')).content[0].text);
    assert.equal(health.healthy, false, 'check_schema_health should catch the still-broken required category field');
    assert.ok(health.problems.some((p: any) => p.collection === 'blog-posts' && p.field === 'category'), 'health report should name the broken field');

    // Drop the requirement so later steps can create/update blog-posts entries
    // without supplying category.
    await mcpTool(upWriteKey, 'update_field', { collection: 'blog-posts', field: 'category', required: false, force: true });

    // HTTP route guard: same block/force behavior through the admin form.
    const guardBlocked = await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/add`, {
      form: { label: 'Priority', type: 'number', required: '1' },
    });
    assert.equal(guardBlocked.status, 400, 'HTTP field add violating existing entries should render 400');
    assert.ok((await guardBlocked.text()).includes('Apply anyway'), 'blocked HTTP add should offer the force retry');
    const guardForced = await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/add`, {
      form: { label: 'Priority', type: 'number', required: '1', force: '1' },
    });
    assert.equal(guardForced.status, 302, 'HTTP field add with force=1 should succeed');
    const withPriority = getCollection(projectDb, 'blog-posts');
    assert.ok(withPriority.fields.some((f) => f.name === 'priority'), 'forced HTTP add should create the field');

    // Drop the requirement so later steps can create/update blog-posts entries
    // without supplying priority.
    await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/update`, {
      form: { field: 'priority', label: 'Priority', type: 'number', force: '1' },
    });
  }

  // 9b. Draft-vs-published signal: editing a published entry leaves
  // has_unpublished_changes set until it is republished; the flag is
  // authoring-only and never rides on a default (published) read.
  const pubEntry = JSON.parse((await mcpTool(upWriteKey, 'create_entry', { collection: 'blog-posts', slug: 'dirty-demo', data: { body: 'live' }, publish: true })).content[0].text);
  assert.ok(!pubEntry.has_unpublished_changes, 'a freshly published entry is not dirty');
  const editedEntry = JSON.parse((await mcpTool(upWriteKey, 'update_entry', { collection: 'blog-posts', slug: 'dirty-demo', data: { body: 'edited' } })).content[0].text);
  assert.equal(editedEntry.has_unpublished_changes, true, 'editing a published entry sets has_unpublished_changes');
  const liveRead = JSON.parse((await mcpTool(apiKey, 'get_entry', { collection: 'blog-posts', slug: 'dirty-demo' })).content[0].text);
  assert.ok(liveRead.body === 'live' && liveRead.has_unpublished_changes === undefined, 'default get_entry serves published data with no authoring flag');
  const draftRead = JSON.parse((await mcpTool(apiKey, 'get_entry', { collection: 'blog-posts', slug: 'dirty-demo', draft: true })).content[0].text);
  assert.ok(draftRead.body === 'edited' && draftRead.has_unpublished_changes === true, 'draft get_entry shows the edited value and the flag');
  await mcpTool(upWriteKey, 'publish_entry', { collection: 'blog-posts', slug: 'dirty-demo' });
  const cleanRead = JSON.parse((await mcpTool(apiKey, 'get_entry', { collection: 'blog-posts', slug: 'dirty-demo', draft: true })).content[0].text);
  assert.ok(cleanRead.has_unpublished_changes === undefined, 'republish clears has_unpublished_changes');
  await mcpTool(upWriteKey, 'delete_entry', { collection: 'blog-posts', slug: 'dirty-demo' });

  // 10. Atomic revert to the first revision
  const revertRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}/revert`, {
    form: { revision_id: String(revisions[0].id) },
  });
  assert.equal(revertRes.status, 302, 'revert should redirect');
  entry = getEntry(projectDb, collection.id, entrySlug);
  assert.equal(entry.data.body, '# First draft', 'revert should restore the previous field value');

  // 10b. Bulk cosmetic ref rewrite: swap a URL without moving updated_at.
  {
    const oldUrl = 'https://cdn.example.com/a.png';
    const newUrl = 'https://cdn.example.com/a.webp';
    const seed = await fetch(`${base}/mcp/${slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${upWriteKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_entry', arguments: { collection: 'blog-posts', slug: entrySlug, data: { body: `see ${oldUrl}` }, publish: true } } }),
    });
    assert.equal(seed.status, 200, 'seeding a URL into the entry should succeed');
    const before: any = await (await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
    const updatedAtBefore = before.items[0].updated_at;

    const rewriteUrl = `${base}/api/v1/${slug}/rewrite-refs`;
    const rrHeaders = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
    assert.equal((await fetch(rewriteUrl, { method: 'POST', headers: rrHeaders(apiKey), body: JSON.stringify({ pairs: [{ old: oldUrl, new: newUrl }] }) })).status, 403, 'rewrite-refs needs a write key');
    assert.equal((await fetch(rewriteUrl, { method: 'POST', headers: rrHeaders(upWriteKey), body: JSON.stringify({ pairs: [{ old: '.png', new: '.webp' }] }) })).status, 400, 'bare extension should be rejected');
    assert.equal((await fetch(rewriteUrl, { method: 'POST', headers: rrHeaders(upWriteKey), body: JSON.stringify({ pairs: [{ old: oldUrl, new: oldUrl }] }) })).status, 400, 'no-op pair should be rejected');

    const dry: any = await (await fetch(rewriteUrl, { method: 'POST', headers: rrHeaders(upWriteKey), body: JSON.stringify({ pairs: [{ old: oldUrl, new: newUrl }], dry_run: true }) })).json();
    assert.equal(dry.entries_touched, 1, 'dry run should match the seeded entry');
    assert.equal(dry.content_version_bumped, false, 'dry run must not bump content_version');
    const stillOld: any = await (await fetch(`${base}/api/v1/${slug}/blog-posts/${entrySlug}`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
    assert.ok(stillOld.body.includes(oldUrl), 'dry run must not change stored content');

    const live: any = await (await fetch(rewriteUrl, { method: 'POST', headers: rrHeaders(upWriteKey), body: JSON.stringify({ pairs: [{ old: oldUrl, new: newUrl }] }) })).json();
    assert.equal(live.entries_touched, 1, 'live run should touch the seeded entry');
    assert.equal(live.content_version_bumped, true, 'live run should bump content_version once');
    const after: any = await (await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
    assert.ok(after.items[0].body.includes(newUrl) && !after.items[0].body.includes(oldUrl), 'live run should swap the URL in the served content');
    assert.equal(after.items[0].updated_at, updatedAtBefore, 'rewrite must NOT change updated_at (sitemap lastmod stays frozen)');
  }

  // 10c. REST /call parity: every MCP tool is reachable over plain REST with a
  // Bearer key, so a headless client never needs the JSON-RPC framing or a
  // separate MCP-access grant. This is the structural guard against the MCP and
  // REST surfaces drifting apart.
  {
    const callUrl = (tool: string) => `${base}/api/v1/${slug}/call/${tool}`;
    const callHeaders = (key: string) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });
    const call = (key: string, tool: string, args: any) =>
      fetch(callUrl(tool), { method: 'POST', headers: callHeaders(key), body: JSON.stringify(args) });

    // Parity invariant: NO tool in the registry may be missing from REST. A
    // 404 (unknown_tool) here means a tool exists on MCP but not REST. Probed
    // with the READ key so write tools refuse at the scope gate (403) before
    // their handler runs: this asserts wiring without mutating any state.
    for (const t of toolCatalog) {
      const r = await call(apiKey, t.name, {});
      assert.notEqual(r.status, 404, `tool ${t.name} must be reachable over REST /call (drift: MCP-only tool)`);
    }

    // Auth: unknown tool 404, missing key 401, read key refused on a write tool.
    assert.equal((await call(upWriteKey, 'no_such_tool', {})).status, 404, 'unknown tool over REST /call is 404');
    assert.equal((await fetch(callUrl('create_entry'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'REST /call needs a key');
    assert.equal((await call(apiKey, 'create_entry', { collection: 'blog-posts', data: { body: 'x' } })).status, 403, 'write tool with a read key is 403 over REST /call');

    // Functional: create, update, publish an entry entirely over REST /call,
    // then confirm the public REST read serves it (full write lifecycle, no MCP).
    const createRes = await call(upWriteKey, 'create_entry', { collection: 'blog-posts', slug: 'rest-call-demo', data: { body: 'via rest call' }, publish: true });
    assert.equal(createRes.status, 200, 'create_entry over REST /call should succeed');
    const createBody: any = await createRes.json();
    assert.equal(createBody.status, 'published', 'create_entry with publish over REST /call should publish');
    const served: any = await (await fetch(`${base}/api/v1/${slug}/blog-posts/rest-call-demo`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
    assert.equal(served.body, 'via rest call', 'entry created over REST /call should be served by the public read API');
    await call(upWriteKey, 'update_entry', { collection: 'blog-posts', slug: 'rest-call-demo', data: { body: 'edited via rest call' }, publish: true });
    const reServed: any = await (await fetch(`${base}/api/v1/${slug}/blog-posts/rest-call-demo`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
    assert.equal(reServed.body, 'edited via rest call', 'update_entry over REST /call should persist and republish');
    await call(upWriteKey, 'delete_entry', { collection: 'blog-posts', slug: 'rest-call-demo' });
    assert.equal((await fetch(`${base}/api/v1/${slug}/blog-posts/rest-call-demo`, { headers: { Authorization: `Bearer ${apiKey}` } })).status, 404, 'delete_entry over REST /call should remove the entry');
  }

  // 11. Media: upload to the local backend, serve it back, delete it
  const fileData = 'hello media';
  const boundary = 'smokeboundary';
  const multipartBody =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="note.txt"\r\nContent-Type: text/plain\r\n\r\n${fileData}\r\n--${boundary}--\r\n`;
  const uploadRes = await fetch(`${base}/admin/projects/${slug}/media`, {
    method: 'POST',
    redirect: 'manual',
    headers: withCookie({ 'Content-Type': `multipart/form-data; boundary=${boundary}` }),
    body: multipartBody,
  });
  assert.equal(uploadRes.status, 302, 'media upload should redirect');

  const mediaPageRes = await req('GET', `/admin/projects/${slug}/media`);
  const mediaHtml = await mediaPageRes.text();
  const mediaKey = (mediaHtml.match(/\/media\/demo-project\/([a-z0-9-]+\.txt)/) || [])[1];
  assert.ok(mediaKey, 'media page should list the uploaded file');
  assert.ok(!mediaHtml.includes('<datalist'), 'media page should not use a datalist for group suggestions');
  assert.ok(!mediaHtml.includes('Projects overview'), 'project switcher should not offer a Projects overview option');

  const served = await fetch(`${base}/media/${slug}/${mediaKey}`);
  assert.equal(served.status, 200, 'media serve route should return the file');
  assert.equal(await served.text(), fileData, 'served bytes should match the upload');
  assert.ok((served.headers.get('cache-control') || '').includes('immutable'), 'media should be cached as immutable');

  const mediaId = (mediaHtml.match(/media\/(\d+)\/delete/) || [])[1];
  assert.ok(mediaId, 'media card should include a delete form');
  const mediaDelete = await req('POST', `/admin/projects/${slug}/media/${mediaId}/delete`);
  assert.equal(mediaDelete.status, 302, 'media delete should redirect');
  const servedGone = await fetch(`${base}/media/${slug}/${mediaKey}`);
  assert.equal(servedGone.status, 404, 'deleted media should 404');

  // 11b. Media v2: usage scan + storage sync (local backend)
  const usageUpload = await fetch(`${base}/admin/projects/${slug}/media`, {
    method: 'POST',
    redirect: 'manual',
    headers: withCookie({ 'Content-Type': `multipart/form-data; boundary=${boundary}` }),
    body: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pic.txt"\r\nContent-Type: text/plain\r\n\r\nusage target\r\n--${boundary}--\r\n`,
  });
  assert.equal(usageUpload.status, 302, 'second media upload should redirect');
  const usageKey = ((await (await req('GET', `/admin/projects/${slug}/media`)).text()).match(/\/media\/demo-project\/([a-z0-9-]+\.txt)/) || [])[1];
  assert.ok(usageKey, 'uploaded usage file should be listed');

  await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}`, {
    form: { field_body: `![pic](/media/${slug}/${usageKey})`, field_cover: '' },
  });
  const usageHtml = await (await req('GET', `/admin/projects/${slug}/media`)).text();
  assert.ok(usageHtml.includes('Used in 1 entry'), 'usage scan should find the referencing entry');

  // Check-first sync: the plain run only reports, apply=1 adopts.
  const { writeFileSync: wf, unlinkSync: ul } = await import('node:fs');
  const strayPath = path.join(dataDir, 'media', slug, 'deadbeef-stray.txt');
  wf(strayPath, 'outside upload');
  const syncCheck = await req('POST', `/admin/projects/${slug}/media/sync`);
  assert.equal(syncCheck.status, 200, 'sync check should render a report');
  const syncCheckHtml = await syncCheck.text();
  assert.ok(syncCheckHtml.includes('deadbeef-stray.txt'), 'sync check should list the adoptable file');
  assert.ok(syncCheckHtml.includes('Nothing changed yet'), 'sync check must not adopt anything');
  assert.ok(!(await (await req('GET', `/admin/projects/${slug}/media`)).text()).includes('deadbeef-stray'), 'checked file must not become a row yet');

  const syncApply = await req('POST', `/admin/projects/${slug}/media/sync`, { form: { apply: '1' } });
  assert.equal(syncApply.status, 200, 'sync apply should render a report');
  assert.ok((await syncApply.text()).includes('1 adopted'), 'sync apply should adopt the outside file');

  ul(strayPath);
  const sync2Html = await (await req('POST', `/admin/projects/${slug}/media/sync`)).text();
  assert.ok(sync2Html.includes('1 missing'), 'sync should flag the row whose file is gone');

  // 11c. JSON upload, storage registry, icon, MCP snippet
  const jsonUpload = await fetch(`${base}/admin/projects/${slug}/media`, {
    method: 'POST',
    redirect: 'manual',
    headers: withCookie({ 'Content-Type': `multipart/form-data; boundary=${boundary}` }),
    body: `--${boundary}\r\nContent-Disposition: form-data; name="json"\r\n\r\n1\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hero.txt"\r\nContent-Type: text/plain\r\n\r\nhero bytes\r\n--${boundary}--\r\n`,
  });
  assert.equal(jsonUpload.status, 200, 'json=1 upload should return 200 JSON');
  const jsonUploadBody: any = await jsonUpload.json();
  assert.ok(jsonUploadBody.url.startsWith(`/media/${slug}/`), 'json upload should return the serve URL');

  const galleryHtml = await (await req('GET', `/admin/projects/${slug}/media`)).text();
  assert.ok(galleryHtml.includes('data-media-search'), 'media page should have a search box');
  assert.ok(!galleryHtml.includes('data-media-folder'), 'group/folder feature should be gone');

  // Unreachable storage must fail the probe and save nothing.
  const badStorage = await req('POST', '/admin/settings/storage', {
    form: { name: 'R2 Main', endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'assets', key: 'AK', secret: 'SK', public_url: 'https://cdn.example.com/' },
  });
  assert.equal(badStorage.status, 400, 'storage save should fail the probe with bad credentials');
  assert.ok((await badStorage.text()).includes('Storage test failed'), 'probe failure should be reported');

  const storageSave = await req('POST', '/admin/settings/storage', {
    form: { name: 'R2 Main', endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'assets', key: 'AK', secret: 'SK', public_url: 'https://cdn.example.com/', skip_test: '1' },
  });
  assert.equal(storageSave.status, 200, 'storage save with skip_test should render success');
  assert.ok((await storageSave.text()).includes('r2-main'), 'storage save should confirm the slugified name');
  const projectPageHtml = await (await req('GET', `/admin/projects/${slug}`)).text();
  assert.ok(projectPageHtml.includes('r2-main'), 'project page should offer the shared storage');

  // Storage edit: non-secret fields come back pre-filled, secret is write-only
  // and a blank secret on save keeps the stored one.
  const settingsHtml = await (await req('GET', '/admin/settings')).text();
  assert.ok(settingsHtml.includes('r2-main'), 'settings page should list saved storages');
  assert.ok(!settingsHtml.includes('storage_r2-main'), 'storage blobs must not show up as plain secrets');
  const storageEditHtml = await (await req('GET', '/admin/settings?storage=r2-main')).text();
  assert.ok(storageEditHtml.includes('value="https://acc.r2.cloudflarestorage.com"'), 'storage edit should pre-fill the endpoint');
  assert.ok(storageEditHtml.includes('value="assets"'), 'storage edit should pre-fill the bucket');
  assert.ok(storageEditHtml.includes('Leave blank to keep'), 'storage edit should explain blank-keeps-secret');
  assert.ok(!storageEditHtml.includes('value="SK"'), 'storage edit must never render the secret');
  const storageUpdate = await req('POST', '/admin/settings/storage', {
    form: { name: 'r2-main', endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'assets', key: 'AK2', secret: '', public_url: 'https://cdn.example.com/', skip_test: '1' },
  });
  assert.equal(storageUpdate.status, 200, 'storage update with blank secret should save');
  const storedBlob = JSON.parse(getSettingValue(app.coreDb, masterKey, { scope: 'global', key: 'storage_r2-main' }) || '{}');
  assert.equal(storedBlob.secret, 'SK', 'blank secret on edit should keep the stored secret');
  assert.equal(storedBlob.key, 'AK2', 'non-secret fields should update on edit');
  // put the access key back so the pin/migrate flow below sees the original config
  await req('POST', '/admin/settings/storage', {
    form: { name: 'r2-main', endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'assets', key: 'AK', secret: '', public_url: 'https://cdn.example.com/', skip_test: '1' },
  });

  // Switching storage pins existing rows to where they live: links keep
  // working from the old storage and the page offers a migration.
  const pickStorage = await req('POST', `/admin/projects/${slug}/storage`, { form: { storage: 'r2-main' } });
  assert.equal(pickStorage.status, 302, 'storage select should redirect');
  const s3MediaHtml = await (await req('GET', `/admin/projects/${slug}/media`)).text();
  assert.ok(s3MediaHtml.includes(`/media/${slug}/`), 'pinned rows should keep their old app-served URLs');
  assert.ok(s3MediaHtml.includes('old storage'), 'pinned rows should be badged');
  assert.ok(s3MediaHtml.includes('Migrate media to current storage'), 'media page should offer migration');
  assert.ok(!s3MediaHtml.includes(`https://cdn.example.com/${slug}/`), 'public URLs must not embed the project slug');

  // Multi-storage: with the default on r2-main, an upload can still target
  // local disk; the row is pinned to local and serves through the app.
  const localChoiceUpload = await fetch(`${base}/admin/projects/${slug}/media`, {
    method: 'POST',
    redirect: 'manual',
    headers: withCookie({ 'Content-Type': `multipart/form-data; boundary=${boundary}` }),
    body: `--${boundary}\r\nContent-Disposition: form-data; name="json"\r\n\r\n1\r\n--${boundary}\r\nContent-Disposition: form-data; name="storage"\r\n\r\nlocal\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pinned.txt"\r\nContent-Type: text/plain\r\n\r\npinned to disk\r\n--${boundary}--\r\n`,
  });
  assert.equal(localChoiceUpload.status, 200, 'upload with an explicit storage should work');
  const localChoiceBody: any = await localChoiceUpload.json();
  assert.ok(localChoiceBody.url.startsWith(`/media/${slug}/`), 'local-storage upload should serve through the app');
  const multiHtml = await (await req('GET', `/admin/projects/${slug}/media`)).text();
  assert.ok(multiHtml.includes('data-media-storage="local"'), 'row uploaded to a non-default storage should carry its storage label');
  const servedPinned = await fetch(`${base}${localChoiceBody.url}`);
  assert.equal(servedPinned.status, 200, 'row pinned to local disk should serve from disk while the default is S3');
  await req('POST', `/admin/projects/${slug}/media/${localChoiceBody.id}/delete`);

  // Folder drill-down from nested keys (adopted S3 paths).
  projectDb.prepare("INSERT INTO media (filename, key, mime, size, variants, folder, base_url) VALUES ('pic.png', 'docs/2024/pic.png', 'image/png', 10, '{}', '', 'https://cdn.example.com')").run();
  const rootGallery = await (await req('GET', `/admin/projects/${slug}/media`)).text();
  assert.ok(rootGallery.includes('?path=docs'), 'nested keys should show as a folder card at the root');
  assert.ok(!rootGallery.includes('data-media-name="pic.png"'), 'nested files should not flood the root gallery');
  assert.ok(rootGallery.includes('data-media-storage-filter'), 'gallery should offer a storage filter when rows span storages');
  const midGallery = await (await req('GET', `/admin/projects/${slug}/media?path=docs`)).text();
  assert.ok(midGallery.includes('?path=docs%2F2024'), 'drill-down should show the next path level');
  const leafGallery = await (await req('GET', `/admin/projects/${slug}/media?path=docs/2024`)).text();
  assert.ok(leafGallery.includes('data-media-name="pic.png"'), 'leaf level should list the nested file');
  assert.ok(leafGallery.includes('All media'), 'drill-down should render a breadcrumb');
  projectDb.prepare("DELETE FROM media WHERE key = 'docs/2024/pic.png'").run();

  // Check-first sync of a non-default storage with a public base allows
  // nested keys; against the fake bucket it just fails cleanly.
  const badSync = await req('POST', `/admin/projects/${slug}/media/sync`, { form: { storage: 'r2-main' } });
  assert.equal(badSync.status, 400, 'sync check against an unreachable storage should fail cleanly');

  // Migration against the fake bucket fails per row, gracefully: nothing is
  // rewritten and rows stay pinned to the working old URLs.
  const migrateRes = await req('POST', `/admin/projects/${slug}/media/migrate`);
  assert.equal(migrateRes.status, 200, 'migration should render a report even on failure');
  const migrateHtml = await migrateRes.text();
  assert.ok(migrateHtml.includes('failed'), 'migration report should count failures');
  assert.ok(migrateHtml.includes('old storage'), 'failed rows should stay pinned');

  // Old-copy cleanup: put one row in the exact state a successful migration
  // leaves behind (follows current storage, old copy on local disk), then
  // delete the old copy through the cleanup action.
  projectDb.prepare('UPDATE media SET base_url = NULL, migrated_from = ? WHERE key = ?').run('', jsonUploadBody.key);
  const localCopyPath = path.join(dataDir, 'media', slug, jsonUploadBody.key);
  assert.ok(existsSync(localCopyPath), 'old local copy should exist before cleanup');
  const withOldCopies = await (await req('GET', `/admin/projects/${slug}/media`)).text();
  assert.ok(withOldCopies.includes('Delete old copies now'), 'media page should offer old-copy cleanup');
  const cleanupRes = await req('POST', `/admin/projects/${slug}/media/cleanup`);
  assert.equal(cleanupRes.status, 200, 'cleanup should render a report');
  const cleanupHtml = await cleanupRes.text();
  assert.ok(cleanupHtml.includes('deleted'), 'cleanup report should count deletions');
  assert.ok(!existsSync(localCopyPath), 'old local copy should be deleted by cleanup');
  assert.ok(!cleanupHtml.includes('Delete old copies now'), 'cleanup banner should disappear once done');

  // Switching back unpins rows whose base matches again: nothing stale.
  // (Re-pin the cleaned row to local first; its object never reached the
  // fake bucket, so letting it follow the current storage would pin it to
  // the cdn base on switch and leave it stale.)
  projectDb.prepare('UPDATE media SET base_url = ? WHERE key = ?').run('', jsonUploadBody.key);
  await req('POST', `/admin/projects/${slug}/storage`, { form: { storage: 'local' } }); // back to disk for the rest
  const backLocalHtml = await (await req('GET', `/admin/projects/${slug}/media`)).text();
  assert.ok(!backLocalHtml.includes('old storage'), 'switching back to the original storage should unpin rows');

  const storageDelete = await req('POST', '/admin/settings/storage/delete', { form: { name: 'r2-main' } });
  assert.equal(storageDelete.status, 302, 'storage delete should redirect');
  assert.equal(getSettingValue(app.coreDb, masterKey, { scope: 'global', key: 'storage_r2-main' }), null, 'deleted storage blob should be gone');

  const iconRes = await req('POST', `/admin/projects/${slug}/rename`, { form: { name: 'Demo Project', icon: '🚀' } });
  assert.equal(iconRes.status, 302, 'rename with icon should redirect');
  const listHtml = await (await req('GET', '/admin/projects')).text();
  assert.ok(listHtml.includes('🚀'), 'projects list should show the icon');

  const keysHtml = await (await req('GET', `/admin/projects/${slug}/api-keys`)).text();
  assert.ok(keysHtml.includes(`${base}/mcp/${slug}`), 'MCP snippet should use the live request origin');

  // 12. Transfer: schema export/apply, collection export, CSV import flow
  const schemaRes = await req('GET', `/admin/projects/${slug}/schema.json`);
  assert.equal(schemaRes.status, 200, 'schema export should be 200');
  const schema: any = await schemaRes.json();
  assert.ok(schema.collections.some((c) => c.slug === 'blog-posts'), 'schema export should include the collection');

  const applyRes = await req('POST', `/admin/projects/${slug}/schema/apply`, {
    form: {
      schema: JSON.stringify({
        collections: [
          ...schema.collections,
          { name: 'Pages', slug: 'pages', fields: [{ name: 'title', label: 'Title', type: 'text' }] },
        ],
      }),
    },
  });
  assert.equal(applyRes.status, 200, 'schema apply should render a report');
  assert.ok(getCollection(projectDb, 'pages'), 'schema apply should create the new collection');
  // Idempotent: applying again changes nothing and deletes nothing.
  await req('POST', `/admin/projects/${slug}/schema/apply`, {
    form: { schema: JSON.stringify({ collections: [...schema.collections, { name: 'Pages', slug: 'pages', fields: [{ name: 'title', label: 'Title', type: 'text' }] }] }) },
  });
  assert.ok(getCollection(projectDb, 'blog-posts'), 'reapply should not delete anything');

  const exportRes = await req('GET', `/admin/projects/${slug}/collections/blog-posts/export.json`);
  assert.equal(exportRes.status, 200, 'collection export should be 200');
  const exported: any = await exportRes.json();
  assert.equal(exported.entries.length, 1, 'export should carry the entry');
  assert.equal(exported.entries[0].data.body, `![pic](/media/${slug}/${usageKey})`, 'export should carry field data');

  // CSV import into pages, with a created field and a unique re-import.
  const csv = 'title,views\r\nHome,10\r\nAbout,twenty\r\n';
  async function uploadCsv() {
    const b = 'smokeboundary';
    const body =
      `--${b}\r\nContent-Disposition: form-data; name="collection"\r\n\r\npages\r\n` +
      `--${b}\r\nContent-Disposition: form-data; name="file"; filename="pages.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${b}--\r\n`;
    return fetch(`${base}/admin/projects/${slug}/import`, {
      method: 'POST',
      redirect: 'manual',
      headers: withCookie({ 'Content-Type': `multipart/form-data; boundary=${b}` }),
      body,
    });
  }
  const importRes = await uploadCsv();
  assert.equal(importRes.status, 200, 'import upload should render the mapping screen');
  const mappingHtml = await importRes.text();
  const importId = (mappingHtml.match(/import\/([0-9a-f-]{36})\/check/) || [])[1];
  assert.ok(importId, 'mapping screen should carry the import id');

  const importForm = { src_0: 'title', map_0: 'field:title', src_1: 'views', map_1: 'create:number', unique: 'title' };
  const checkRes = await req('POST', `/admin/projects/${slug}/import/${importId}/check`, { form: importForm });
  assert.equal(checkRes.status, 200, 'dry run should render a report');
  const checkHtml = await checkRes.text();
  assert.ok(checkHtml.includes('2 new'), 'dry run should count new rows');
  assert.ok(checkHtml.includes('kept raw'), 'dry run should flag the bad number value');

  const applyImportRes = await req('POST', `/admin/projects/${slug}/import/${importId}/apply`, { form: importForm });
  assert.equal(applyImportRes.status, 200, 'apply should render the result');
  const pages = getCollection(projectDb, 'pages');
  assert.ok(pages.fields.some((f) => f.name === 'views' && f.type === 'number'), 'import should create the mapped field');
  const pageEntries = app.projectDbs.get(slug).prepare('SELECT data FROM entries WHERE collection_id = ?').all(pages.id).map((r) => JSON.parse(r.data));
  assert.equal(pageEntries.length, 2, 'import should create both rows');
  assert.equal(pageEntries.find((e) => e.title === 'Home').views, 10, 'number coercion should parse');
  assert.equal(pageEntries.find((e) => e.title === 'About').views, 'twenty', 'unparseable number should keep the raw value');

  // Re-import with the unique field: updates, no duplicates.
  const reImport = await uploadCsv();
  const reId = ((await reImport.text()).match(/import\/([0-9a-f-]{36})\/check/) || [])[1];
  const reForm = { src_0: 'title', map_0: 'field:title', src_1: 'views', map_1: 'field:views', unique: 'title' };
  await req('POST', `/admin/projects/${slug}/import/${reId}/apply`, { form: reForm });
  const afterRe = app.projectDbs.get(slug).prepare('SELECT COUNT(*) AS n FROM entries WHERE collection_id = ?').get(pages.id);
  assert.equal(afterRe.n, 2, 'unique-field re-import should update, not duplicate');

  // 13. MCP: handshake, tool scoping, agent edits with revisions, rate limit
  const rpc = (key: string, method: string, params: any = {}, id: number | undefined = 1) =>
    fetch(`${base}/mcp/${slug}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });

  const mcpNoAuth = await fetch(`${base}/mcp/${slug}`, { method: 'POST', body: '{}' });
  assert.equal(mcpNoAuth.status, 401, 'MCP without a key should be 401');

  const init: any = await (await rpc(apiKey, 'initialize')).json();
  assert.ok(init.result.protocolVersion, 'initialize should return a protocol version');
  assert.ok(init.result.serverInfo.name.includes('Boring CMS'), 'initialize should name the server');

  const readTools: any = await (await rpc(apiKey, 'tools/list')).json();
  const readNames = readTools.result.tools.map((t) => t.name);
  assert.ok(readNames.includes('list_collections'), 'read key should see read tools');
  assert.ok(!readNames.includes('create_entry'), 'read key should not see write tools');

  const writeDenied: any = await (
    await rpc(apiKey, 'tools/call', { name: 'create_entry', arguments: { collection: 'blog-posts', data: {} } })
  ).json();
  assert.ok(writeDenied.error.message.includes('read-only'), 'write tool with read key should be refused');

  const writeKeyPage = await req('POST', `/admin/projects/${slug}/api-keys`, { form: { name: 'agent', scope: 'write', mcp: '1' } });
  const writeKey = ((await writeKeyPage.text()).match(/yn_[A-Za-z0-9_-]+/) || [])[0];
  assert.ok(writeKey, 'write-scope key should be created');

  const writeTools: any = await (await rpc(writeKey, 'tools/list')).json();
  assert.ok(writeTools.result.tools.some((t) => t.name === 'create_entry'), 'write key should see write tools');

  const created: any = await (
    await rpc(writeKey, 'tools/call', { name: 'create_entry', arguments: { collection: 'blog-posts', data: { body: 'agent draft' }, publish: true } })
  ).json();
  const createdEntry = JSON.parse(created.result.content[0].text);
  assert.equal(createdEntry.status, 'published', 'create_entry with publish should publish');

  const mcpList: any = await (
    await rpc(apiKey, 'tools/call', { name: 'list_entries', arguments: { collection: 'blog-posts' } })
  ).json();
  const mcpItems = JSON.parse(mcpList.result.content[0].text);
  assert.ok(mcpItems.some((i) => i.slug === createdEntry.slug), 'MCP list_entries should include the agent entry');

  await rpc(writeKey, 'tools/call', { name: 'update_entry', arguments: { collection: 'blog-posts', slug: createdEntry.slug, data: { body: 'agent edit' } } });
  const agentEntry = getEntry(projectDb, collection.id, createdEntry.slug);
  assert.equal(agentEntry.data.body, 'agent edit', 'update_entry should persist');
  assert.equal(listRevisions(projectDb, agentEntry.id).length, 1, 'agent edit should record a revision');

  const unpub: any = await (
    await rpc(writeKey, 'tools/call', { name: 'unpublish_entry', arguments: { collection: 'blog-posts', slug: createdEntry.slug } })
  ).json();
  assert.equal(JSON.parse(unpub.result.content[0].text).status, 'draft', 'unpublish_entry should return to draft');

  const badTool: any = await (await rpc(apiKey, 'tools/call', { name: 'nope' })).json();
  assert.ok(badTool.error, 'unknown tool should be a JSON-RPC error');

  // MCP v2: publish on update, batch upsert, updated_since, delete, retry_after.
  const upPub: any = await (
    await rpc(writeKey, 'tools/call', { name: 'update_entry', arguments: { collection: 'blog-posts', slug: createdEntry.slug, data: { body: 'v2 edit' }, publish: true } })
  ).json();
  assert.equal(JSON.parse(upPub.result.content[0].text).status, 'published', 'update_entry publish flag should publish');
  const mcpPubEvent = await waitForWebhook((e) => e.body?.event === 'entry.publish' && e.body?.slug === createdEntry.slug);
  assert.ok(mcpPubEvent, 'MCP update_entry with publish=true should fire entry.publish');

  const batch: any = await (
    await rpc(writeKey, 'tools/call', {
      name: 'batch_create_entries',
      arguments: {
        collection: 'blog-posts',
        publish: true,
        entries: [
          { slug: 'batch-one', data: { body: 'one' } },
          { slug: 'batch-two', data: { body: 'two' } },
          { slug: createdEntry.slug, data: { body: 'upserted' } },
        ],
      },
    })
  ).json();
  const batchOut = JSON.parse(batch.result.content[0].text);
  assert.equal(batchOut.created, 2, 'batch should create two entries');
  assert.equal(batchOut.updated, 1, 'batch should upsert the existing entry');
  assert.equal(batchOut.failed, 0, 'batch should have no failures');

  const since: any = await (
    await rpc(apiKey, 'tools/call', { name: 'list_entries', arguments: { collection: 'blog-posts', updated_since: '2000-01-01 00:00:00' } })
  ).json();
  const sinceItems = JSON.parse(since.result.content[0].text);
  assert.ok(sinceItems.length > 0 && sinceItems.every((i) => i.slug && i.updated_at), 'list_entries items should carry slug and updated_at');
  assert.ok(sinceItems.every((i) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(i.updated_at)), 'updated_at should be ISO 8601 UTC with Z');
  // Cursor round-trip: an ISO value with milliseconds and Z (what a JS
  // client sends from toISOString) must match entries written just now.
  const recentSince: any = await (
    await rpc(apiKey, 'tools/call', { name: 'list_entries', arguments: { collection: 'blog-posts', updated_since: new Date(Date.now() - 60_000).toISOString() } })
  ).json();
  assert.ok(JSON.parse(recentSince.result.content[0].text).length > 0, 'millisecond ISO updated_since should match fresh writes');
  const noneSince: any = await (
    await rpc(apiKey, 'tools/call', { name: 'list_entries', arguments: { collection: 'blog-posts', updated_since: '2999-01-01 00:00:00' } })
  ).json();
  assert.equal(JSON.parse(noneSince.result.content[0].text).length, 0, 'future updated_since should return nothing');
  const mcpSinceBare: any = await (
    await rpc(apiKey, 'tools/call', { name: 'list_entries', arguments: { collection: 'blog-posts', updated_since: '2000-01-01T00:00:00' } })
  ).json();
  const mcpSinceZulu: any = await (
    await rpc(apiKey, 'tools/call', { name: 'list_entries', arguments: { collection: 'blog-posts', updated_since: '2000-01-01T00:00:00Z' } })
  ).json();
  assert.equal(
    JSON.parse(mcpSinceBare.result.content[0].text).length,
    JSON.parse(mcpSinceZulu.result.content[0].text).length,
    'MCP bare ISO updated_since should match Zulu form',
  );

  // A user data field named updated_at (WP imports) must never shadow the
  // row's write clock, or incremental pulls see stale values.
  projectDb
    .prepare("UPDATE entries SET published_data = json_set(published_data, '$.updated_at', '2020-01-01 00:00:00') WHERE slug = ?")
    .run('batch-one');
  const shadowed: any = await (
    await rpc(apiKey, 'tools/call', { name: 'get_entry', arguments: { collection: 'blog-posts', slug: 'batch-one' } })
  ).json();
  assert.notEqual(JSON.parse(shadowed.result.content[0].text).updated_at, '2020-01-01 00:00:00', 'row updated_at should win over a same-named data field');

  // preserve_timestamps: update+publish without bumping dates
  const ptEntry: any = JSON.parse(
    ((await (await rpc(writeKey, 'tools/call', { name: 'create_entry', arguments: { collection: 'blog-posts', data: { body: 'pt-test' }, publish: true } })).json()) as any).result.content[0].text,
  );
  const ptRow = projectDb.prepare('SELECT updated_at, published_at FROM entries WHERE slug = ?').get(ptEntry.slug);
  const ptUpdate: any = await (
    await rpc(writeKey, 'tools/call', { name: 'update_entry', arguments: { collection: 'blog-posts', slug: ptEntry.slug, data: { body: 'pt-edited' }, publish: true, preserve_timestamps: true } })
  ).json();
  assert.ok(!ptUpdate.result.isError, 'preserve_timestamps update should succeed');
  const ptRowAfter = projectDb.prepare('SELECT updated_at, published_at FROM entries WHERE slug = ?').get(ptEntry.slug);
  assert.equal(ptRowAfter.updated_at, ptRow.updated_at, 'preserve_timestamps should freeze updated_at');
  assert.equal(ptRowAfter.published_at, ptRow.published_at, 'preserve_timestamps should freeze published_at on republish');
  // normal update (no flag) should still bump
  projectDb.prepare("UPDATE entries SET updated_at = '2020-01-01 00:00:00' WHERE slug = ?").run(ptEntry.slug);
  await rpc(writeKey, 'tools/call', { name: 'update_entry', arguments: { collection: 'blog-posts', slug: ptEntry.slug, data: { body: 'pt-bumped' } } });
  const ptRowBumped = projectDb.prepare('SELECT updated_at FROM entries WHERE slug = ?').get(ptEntry.slug);
  assert.notEqual(ptRowBumped.updated_at, '2020-01-01 00:00:00', 'normal update should bump updated_at');
  await rpc(writeKey, 'tools/call', { name: 'delete_entry', arguments: { collection: 'blog-posts', slug: ptEntry.slug } });

  // preserve_timestamps via batch_create_entries upsert
  const ptBatchEntry: any = JSON.parse(
    ((await (await rpc(writeKey, 'tools/call', { name: 'create_entry', arguments: { collection: 'blog-posts', data: { body: 'ptb-test' }, publish: true } })).json()) as any).result.content[0].text,
  );
  const ptbRow = projectDb.prepare('SELECT updated_at, published_at FROM entries WHERE slug = ?').get(ptBatchEntry.slug);
  const ptBatch: any = await (
    await rpc(writeKey, 'tools/call', { name: 'batch_create_entries', arguments: { collection: 'blog-posts', entries: [{ slug: ptBatchEntry.slug, data: { body: 'ptb-edited' } }], publish: true, preserve_timestamps: true } })
  ).json();
  assert.ok(!ptBatch.result.isError, 'batch preserve_timestamps should succeed');
  const ptbRowAfter = projectDb.prepare('SELECT updated_at, published_at FROM entries WHERE slug = ?').get(ptBatchEntry.slug);
  assert.equal(ptbRowAfter.updated_at, ptbRow.updated_at, 'batch preserve_timestamps should freeze updated_at');
  assert.equal(ptbRowAfter.published_at, ptbRow.published_at, 'batch preserve_timestamps should freeze published_at on republish');
  await rpc(writeKey, 'tools/call', { name: 'delete_entry', arguments: { collection: 'blog-posts', slug: ptBatchEntry.slug } });

  // Scheduled publishing: future published_at hides the entry from every public
  // read (REST, MCP), stays visible to write-side tools, ETag flips at go-live.
  {
    const tool = async (key: string, name: string, args: any) => {
      const j: any = await (await rpc(key, 'tools/call', { name, arguments: args })).json();
      const text = j.result?.content?.[0]?.text;
      const err = !!j.error || !!j.result?.isError;
      return { err, out: !err && text ? JSON.parse(text) : (text ?? j.error?.message) };
    };
    const rest = (p: string, headers: any = {}) => fetch(`${base}/api/v1/${slug}/blog-posts${p}`, { headers: { Authorization: `Bearer ${apiKey}`, ...headers } });
    const listEtag = async () => (await rest('')).headers.get('etag');
    const at = new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    await tool(writeKey, 'create_entry', { collection: 'blog-posts', slug: 'sched-demo', data: { body: 'later' } });
    assert.ok((await tool(writeKey, 'publish_entry', { collection: 'blog-posts', slug: 'sched-demo', at: 'nonsense' })).err, 'publish_entry rejects an invalid at');
    const before = await listEtag();
    const sched = await tool(writeKey, 'publish_entry', { collection: 'blog-posts', slug: 'sched-demo', at });
    assert.equal(sched.out.status, 'scheduled', 'future at returns status scheduled');
    assert.equal(sched.out.publish_at, at, 'publish_at echoes the go-live time in UTC');

    assert.equal((await rest('/sched-demo')).status, 404, 'scheduled entry is a 404 on the public single read');
    assert.ok(!JSON.stringify(await (await rest('')).json()).includes('sched-demo'), 'scheduled entry is absent from the public list');
    assert.ok((await tool(apiKey, 'get_entry', { collection: 'blog-posts', slug: 'sched-demo' })).err, 'MCP published read hides a scheduled entry');
    const draftRead = await tool(apiKey, 'get_entry', { collection: 'blog-posts', slug: 'sched-demo', draft: true });
    assert.equal(draftRead.out.status, 'scheduled', 'draft read reports scheduled');
    const listed = await tool(writeKey, 'list_scheduled', { collection: 'blog-posts' });
    assert.ok(listed.out.some((r: any) => r.slug === 'sched-demo' && r.publish_at === at), 'list_scheduled shows the entry with its time');
    assert.ok((await tool(apiKey, 'list_scheduled', { collection: 'blog-posts' })).err, 'list_scheduled needs a write key');

    // Rate limits: new projects start with both off; a project with no stored value keeps the legacy defaults.
    const call = () => fetch(`${base}/api/v1/${slug}/call/list_collections`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await call()).headers.get('ratelimit-limit'), null, 'new project has no write limit');
    projectDb.prepare("DELETE FROM meta WHERE key IN ('rate_limit_per_min', 'counter_ip_limit_per_min')").run();
    assert.equal((await call()).headers.get('ratelimit-limit'), '60', 'project without stored limit keeps the legacy 60/min');

    const held = await tool(writeKey, 'publish_entry', { collection: 'blog-posts', slug: 'sched-demo' });
    assert.equal(held.out.status, 'scheduled', 'republish without at keeps the scheduled state');
    assert.equal((await rest('/sched-demo')).status, 404, 'republish without at does not leak the entry');

    // Admin form: a bad date is a 400 page, not a crash.
    const badForm = await req('POST', `/admin/projects/${slug}/collections/blog-posts/sched-demo/publish`, { form: { publish_at: 'garbage' } });
    assert.equal(badForm.status, 400, 'admin publish with an invalid date is 400');

    // Time passes with no write: the ETag must still flip and the entry appear.
    projectDb.prepare("UPDATE entries SET published_at = datetime('now', '-1 second') WHERE slug = 'sched-demo'").run();
    const after = await listEtag();
    assert.notEqual(after, before, 'ETag changes when a scheduled entry goes live');
    assert.equal((await rest('', { 'If-None-Match': before })).status, 200, 'stale ETag revalidates to 200 after go-live');
    assert.equal((await rest('/sched-demo')).status, 200, 'entry is served once its time passes');
    assert.ok((await (await rest('?updated_since=2000-01-01T00:00:00Z')).text()).includes('sched-demo'), 'updated_since returns the entry');
    assert.equal((await tool(writeKey, 'list_scheduled', { collection: 'blog-posts' })).out.length, 0, 'list_scheduled drops it after go-live');
    assert.doesNotMatch(String(after), /^"?v?\d+(\.\d+)?"?$/, 'ETag is opaque, not a bare version counter');

    // Export carries the go-live time.
    await tool(writeKey, 'create_entry', { collection: 'blog-posts', slug: 'sched-rt', data: { body: 'rt' } });
    await tool(writeKey, 'publish_entry', { collection: 'blog-posts', slug: 'sched-rt', at });
    const exported = JSON.stringify(await (await fetch(`${base}/api/v1/${slug}/export`, { headers: { Authorization: `Bearer ${apiKey}` } })).json());
    assert.ok(exported.includes('sched-rt') && exported.includes(at), 'export carries published_at for a scheduled entry');
    await tool(writeKey, 'delete_entry', { collection: 'blog-posts', slug: 'sched-rt' });
    await tool(writeKey, 'delete_entry', { collection: 'blog-posts', slug: 'sched-demo' });
  }

  const del: any = await (
    await rpc(writeKey, 'tools/call', { name: 'delete_entry', arguments: { collection: 'blog-posts', slug: 'batch-two' } })
  ).json();
  assert.ok(JSON.parse(del.result.content[0].text).deleted, 'delete_entry should report deleted');
  assert.ok(!getEntry(projectDb, collection.id, 'batch-two'), 'deleted entry should be gone from the DB');
  const mcpDelEvent = await waitForWebhook((e) => e.body?.event === 'entry.delete' && e.body?.slug === 'batch-two');
  assert.ok(mcpDelEvent, 'MCP delete_entry of published entry should fire entry.delete');

  // Unique field option: one-step create with flags from the add popover,
  // duplicate values rejected across dashboard/API/MCP naming the holder,
  // an entry keeps its own value on update.
  const uniqAdd = await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/add`, { form: { label: 'Sku', type: 'text', unique: '1', required: '1', force: '1' } });
  assert.equal(uniqAdd.status, 302, 'add field with flags should redirect');
  const skuField = getCollection(projectDb, 'blog-posts').fields.find((f) => f.name === 'sku');
  assert.ok(skuField?.unique && skuField?.required, 'add-field popover should persist required and unique in one step');
  const uniqFirst: any = await (
    await rpc(writeKey, 'tools/call', { name: 'create_entry', arguments: { collection: 'blog-posts', data: { body: 'a', sku: 'SKU-1' } } })
  ).json();
  const uniqFirstSlug = JSON.parse(uniqFirst.result.content[0].text).slug;
  const uniqDupe: any = await (
    await rpc(writeKey, 'tools/call', { name: 'create_entry', arguments: { collection: 'blog-posts', data: { body: 'b', sku: 'SKU-1' } } })
  ).json();
  assert.ok(uniqDupe.result.isError && uniqDupe.result.content[0].text.includes(uniqFirstSlug), 'duplicate unique value should fail naming the holding entry');
  const uniqSelf: any = await (
    await rpc(writeKey, 'tools/call', { name: 'update_entry', arguments: { collection: 'blog-posts', slug: uniqFirstSlug, data: { sku: 'SKU-1' } } })
  ).json();
  assert.ok(!uniqSelf.result.isError, 'an entry should keep its own unique value on update');
  await rpc(writeKey, 'tools/call', { name: 'delete_entry', arguments: { collection: 'blog-posts', slug: uniqFirstSlug } });
  await req('POST', `/admin/projects/${slug}/collections/blog-posts/fields/remove`, { form: { field: 'sku' } });

  let limited = false;
  for (let i = 0; i < 70; i++) {
    const r = await rpc(apiKey, 'ping');
    if (r.status === 429) {
      const body: any = await r.json();
      assert.ok(body.retry_after >= 1, '429 body should carry a retry_after hint');
      limited = true;
      break;
    }
  }
  assert.ok(limited, 'per-key rate limit should kick in');

  // Oversized MCP body: clean 413 with the limit, not a parse error.
  const huge = await fetch(`${base}/mcp/${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeKey}`, 'Content-Type': 'application/json' },
    body: `{"pad":"${'x'.repeat(9 * 1024 * 1024)}"}`,
  });
  assert.equal(huge.status, 413, 'oversized MCP body should return 413');
  assert.ok(((await huge.json()) as any).limit_bytes > 0, '413 body should carry limit_bytes');

  // 14. Auth extras: passkey register + login against a simulated
  // authenticator (real crypto, fake device), account page, Google gating.
  const { generateKeyPairSync, createHash: sha, sign: cryptoSign } = await import('node:crypto');

  // Minimal CBOR encoder, just enough to build authenticator payloads.
  function cbor(value: any): Buffer {
    const head = (major: number, len: number) => {
      if (len < 24) return Buffer.from([(major << 5) | len]);
      if (len < 256) return Buffer.from([(major << 5) | 24, len]);
      const b = Buffer.alloc(3);
      b[0] = (major << 5) | 25;
      b.writeUInt16BE(len, 1);
      return b;
    };
    if (typeof value === 'number') {
      return value >= 0 ? head(0, value) : head(1, -1 - value);
    }
    if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
    if (typeof value === 'string') {
      const b = Buffer.from(value, 'utf8');
      return Buffer.concat([head(3, b.length), b]);
    }
    if (value instanceof Map) {
      const parts: Buffer[] = [head(5, value.size)];
      for (const [k, v] of value) parts.push(cbor(k), cbor(v));
      return Buffer.concat(parts);
    }
    throw new Error('cbor: unsupported');
  }

  const rpId = '127.0.0.1';
  const origin = base;
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk: any = keyPair.publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);

  function makeAuthData(flags: number, counter: number, withCred = false) {
    const rpIdHash = sha('sha256').update(rpId).digest();
    const head = Buffer.alloc(37);
    rpIdHash.copy(head, 0);
    head[32] = flags;
    head.writeUInt32BE(counter, 33);
    if (!withCred) return head;
    const cose = cbor(new Map<any, any>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const credLen = Buffer.alloc(2);
    credLen.writeUInt16BE(credId.length);
    return Buffer.concat([head, Buffer.alloc(16), credLen, credId, cose]);
  }

  const accountRes = await req('GET', '/account');
  assert.equal(accountRes.status, 200, 'account page should render');
  assert.ok((await accountRes.text()).includes('Add a passkey'), 'account page should offer passkey registration');

  // Disabling password login without any alternative must be refused.
  const lockedOut = await req('POST', '/account/login-methods', { form: { password_login: 'off' } });
  assert.equal(lockedOut.status, 400, 'disabling password login with no passkey/Google should be rejected');

  const badPw = await req('POST', '/account/password', { form: { current_password: 'wrong', password: 'newpassword1', password_confirm: 'newpassword1' } });
  assert.equal(badPw.status, 400, 'wrong current password should be rejected');

  // Password change revokes every other session; the current one stays valid.
  {
    const user = getUserByEmail(app.coreDb, email);
    const cookieA = `yn_session=${signValue(masterKey, createSession(app.coreDb, user.id))}`;
    const cookieB = `yn_session=${signValue(masterKey, createSession(app.coreDb, user.id))}`;
    const changePw = await fetch(`${base}/account/password`, {
      method: 'POST',
      headers: { Cookie: cookieA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ current_password: password, password: 'newpassword9', password_confirm: 'newpassword9' }).toString(),
    });
    assert.equal(changePw.status, 200, 'password change should succeed');
    const revoked = await fetch(`${base}/admin/projects`, { headers: { Cookie: cookieB }, redirect: 'manual' });
    assert.equal(revoked.status, 302, 'other session should be revoked after password change');
    assert.equal(revoked.headers.get('location'), '/login');
    const kept = await fetch(`${base}/admin/projects`, { headers: { Cookie: cookieA }, redirect: 'manual' });
    assert.equal(kept.status, 200, 'current session should stay valid after password change');
    password = 'newpassword9';
    cookie = cookieA;
  }

  // Registration over HTTP: options (challenge cookie) then verify + store.
  const sessionCookie = cookie;
  const regOptRes = await fetch(`${base}/webauthn/register/options`, { method: 'POST', headers: { Cookie: sessionCookie } });
  const regOpt: any = await regOptRes.json();
  assert.ok(regOpt.challenge, 'register options should carry a challenge');
  const challengeCookie = regOptRes.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('yn_challenge='));
  assert.ok(challengeCookie, 'register options should set the challenge cookie');

  const regClientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: regOpt.challenge, origin }));
  const attestationObject = cbor(new Map<any, any>([['fmt', 'none'], ['attStmt', new Map()], ['authData', makeAuthData(0x41, 0, true)]]));
  const regRes = await fetch(`${base}/webauthn/register`, {
    method: 'POST',
    headers: { Cookie: `${sessionCookie}; ${challengeCookie}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: credId.toString('base64url'),
      attestationObject: attestationObject.toString('base64url'),
      clientDataJSON: regClientData.toString('base64url'),
      transports: ['internal'],
      name: 'smoke device',
    }),
  });
  assert.equal(regRes.status, 200, `passkey registration should verify: ${await regRes.clone().text()}`);

  const loginPageHtml = await (await fetch(`${base}/login`)).text();
  assert.ok(loginPageHtml.includes('Use a passkey'), 'login page should offer passkeys once one exists');

  // Login over HTTP with a signed assertion, fresh unauthenticated client.
  const loginOptRes = await fetch(`${base}/webauthn/login/options`, { method: 'POST' });
  const loginOpt: any = await loginOptRes.json();
  const loginChallengeCookie = loginOptRes.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('yn_challenge='));
  assert.ok(loginOpt.allowCredentials.some((c) => c.id === credId.toString('base64url')), 'login options should list the credential');

  const assertAuthData = makeAuthData(0x01, 7);
  const loginClientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: loginOpt.challenge, origin }));
  const signature = cryptoSign('sha256', Buffer.concat([assertAuthData, sha('sha256').update(loginClientData).digest()]), keyPair.privateKey);
  const passkeyLogin = await fetch(`${base}/webauthn/login`, {
    method: 'POST',
    headers: { Cookie: loginChallengeCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: credId.toString('base64url'),
      authenticatorData: assertAuthData.toString('base64url'),
      clientDataJSON: loginClientData.toString('base64url'),
      signature: signature.toString('base64url'),
    }),
  });
  assert.equal(passkeyLogin.status, 200, `passkey login should verify: ${await passkeyLogin.clone().text()}`);
  assert.ok(passkeyLogin.headers.getSetCookie().some((c) => c.startsWith('yn_session=')), 'passkey login should issue a session');

  // Replayed counter must be rejected (clone detection).
  const replayOptRes = await fetch(`${base}/webauthn/login/options`, { method: 'POST' });
  const replayOpt: any = await replayOptRes.json();
  const replayCookie = replayOptRes.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('yn_challenge='));
  const replayClientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: replayOpt.challenge, origin }));
  const replaySig = cryptoSign('sha256', Buffer.concat([assertAuthData, sha('sha256').update(replayClientData).digest()]), keyPair.privateKey);
  const replay = await fetch(`${base}/webauthn/login`, {
    method: 'POST',
    headers: { Cookie: replayCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: credId.toString('base64url'),
      authenticatorData: assertAuthData.toString('base64url'),
      clientDataJSON: replayClientData.toString('base64url'),
      signature: replaySig.toString('base64url'),
    }),
  });
  assert.equal(replay.status, 400, 'stale counter should be rejected');

  // Google OAuth is gated on settings: unconfigured start bounces to /login.
  const noGoogle = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  assert.equal(noGoogle.headers.get('location'), '/login', 'Google start without settings should bounce');
  await req('POST', '/admin/settings', { form: { key: 'google_client_id', value: 'id.example' } });
  await req('POST', '/admin/settings', { form: { key: 'google_client_secret', value: 'shhh' } });
  const googleStart = await fetch(`${base}/auth/google`, { redirect: 'manual' });
  assert.ok((googleStart.headers.get('location') || '').startsWith('https://accounts.google.com/'), 'configured Google start should redirect to Google');
  assert.ok(googleStart.headers.get('location').includes('code_challenge='), 'Google start should carry PKCE');
  assert.ok((await (await fetch(`${base}/login`)).text()).includes('Continue with Google'), 'login page should offer Google when configured');

  // With a passkey and Google configured, password login can be turned off.
  const disableRes = await req('POST', '/account/login-methods', { form: { password_login: 'off' } });
  assert.equal(disableRes.status, 200, 'disabling password login with alternatives should succeed');
  const noPwLogin = await (await fetch(`${base}/login`)).text();
  assert.ok(!noPwLogin.includes('name="password"'), 'login page should hide the password form when disabled');
  const pwBlocked = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
  });
  assert.equal(pwBlocked.status, 403, 'password login should return 403 when disabled');
  const enableRes = await req('POST', '/account/login-methods', { form: { password_login: 'on' } });
  assert.equal(enableRes.status, 200, 're-enabling password login should succeed');

  // Passkey removal from the account page.
  const credRow = app.coreDb.prepare('SELECT id FROM credentials').get();
  await req('POST', `/account/passkeys/${credRow.id}/delete`);
  assert.equal(app.coreDb.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 0, 'passkey removal should delete the row');

  // 15. Delete the project (requires exact slug confirmation)
  // Counter fields: public votes need no key, one vote per visitor, switch nets 2,
  // private fields need a write key, counts stay out of the entry payload.
  {
    const tool = async (key: string, name: string, args: any) => {
      const j: any = await (await rpc(key, 'tools/call', { name, arguments: args })).json();
      return { err: !!j.error || !!j.result?.isError, out: j.result?.content?.[0]?.text };
    };
    await tool(writeKey, 'add_field', { collection: 'blog-posts', label: 'Likes', type: 'counter', name: 'likes' });
    await tool(writeKey, 'add_field', { collection: 'blog-posts', label: 'Stars', type: 'counter', name: 'stars', options: { access: 'key' } });
    await tool(writeKey, 'create_entry', { collection: 'blog-posts', slug: 'ctr-demo', data: { body: 'x' } });
    await tool(writeKey, 'publish_entry', { collection: 'blog-posts', slug: 'ctr-demo' });
    const ep = `${base}/api/v1/${slug}/blog-posts/ctr-demo`;
    const bump = (field: string, q: string, ua: string, headers: any = {}) =>
      fetch(`${ep}/counters/${field}${q}`, { method: 'POST', headers: { 'User-Agent': ua, ...headers } });
    let r: any = await (await bump('likes', '?dir=up', 'ua-a')).json();
    assert.deepEqual([r.up, r.down, r.changed], [1, 0, true], 'public vote needs no key');
    r = await (await bump('likes', '?dir=up', 'ua-a')).json();
    assert.deepEqual([r.up, r.down, r.changed], [1, 0, false], 'same visitor same vote is a no-op');
    r = await (await bump('likes', '?dir=down', 'ua-a')).json();
    assert.deepEqual([r.up, r.down], [0, 1], 'switching a vote moves it');
    r = await (await bump('likes', '?dir=up', 'ua-b')).json();
    assert.deepEqual([r.up, r.down], [1, 1], 'a different visitor counts separately');
    assert.equal((await bump('likes', '?dir=sideways', 'ua-a')).status, 400, 'bad dir is 400');
    assert.equal((await bump('nope', '', 'ua-a')).status, 404, 'unknown field is 404');
    assert.equal((await bump('stars', '', 'ua-a')).status, 401, 'private field rejects a keyless vote');
    assert.equal((await bump('stars', '', 'ua-a', { Authorization: `Bearer ${apiKey}` })).status, 403, 'private field rejects a read key');
    r = await (await bump('stars', '?by=5', 'ua-a', { Authorization: `Bearer ${writeKey}` })).json();
    assert.equal(r.up, 5, 'private field takes a step from a write key');
    const pub: any = await (await fetch(`${ep}/counters`)).json();
    assert.deepEqual(pub, { likes: { up: 1, down: 1 } }, 'keyless read hides private counters');
    const priv: any = await (await fetch(`${ep}/counters`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
    assert.equal(priv.stars.up, 5, 'keyed read includes private counters');
    const batch: any = await (await fetch(`${base}/api/v1/${slug}/blog-posts/counters?slugs=ctr-demo,missing`)).json();
    assert.deepEqual(Object.keys(batch.items), ['ctr-demo'], 'batch read returns published slugs only');
    const opt = await fetch(`${ep}/counters/likes`, { method: 'OPTIONS' });
    assert.equal(opt.status, 204, 'CORS preflight answers');
    const payload = JSON.stringify(await (await fetch(ep, { headers: { Authorization: `Bearer ${apiKey}` } })).json());
    assert.ok(!payload.includes('likes'), 'counts are not in the entry payload');
    // Writing a counter-named key must not persist or reach the public payload.
    await tool(writeKey, 'update_entry', { collection: 'blog-posts', slug: 'ctr-demo', data: { body: 'y', likes: { up: 999 } } });
    await tool(writeKey, 'publish_entry', { collection: 'blog-posts', slug: 'ctr-demo' });
    const injected = JSON.stringify(await (await fetch(ep, { headers: { Authorization: `Bearer ${apiKey}` } })).json());
    assert.ok(!injected.includes('999') && !injected.includes('likes'), 'counter keys in written data are stripped');
    // A scheduled (future) entry is hidden: no keyless vote, read or existence probe.
    const later = new Date(Date.now() + 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    await tool(writeKey, 'create_entry', { collection: 'blog-posts', slug: 'ctr-later', data: { body: 'x' } });
    await tool(writeKey, 'publish_entry', { collection: 'blog-posts', slug: 'ctr-later', at: later });
    const lp = `${base}/api/v1/${slug}/blog-posts/ctr-later`;
    assert.equal((await fetch(`${lp}/counters/likes?dir=up`, { method: 'POST', headers: { 'User-Agent': 'ua-x' } })).status, 404, 'no vote on a scheduled entry');
    assert.equal((await fetch(`${lp}/counters`)).status, 404, 'counter read hides a scheduled entry');
    const hidden: any = await (await fetch(`${base}/api/v1/${slug}/blog-posts/counters?slugs=ctr-later`)).json();
    assert.deepEqual(hidden.items, {}, 'batch counter read hides a scheduled entry');
    await tool(writeKey, 'delete_entry', { collection: 'blog-posts', slug: 'ctr-later' });
    await tool(writeKey, 'delete_entry', { collection: 'blog-posts', slug: 'ctr-demo' });
  }

  // Countermap fields: named keys per entry, one vote per visitor per key,
  // "group:option" keys switch within the group, maxKeys caps new keys.
  {
    const tool = async (key: string, name: string, args: any) => {
      const j: any = await (await rpc(key, 'tools/call', { name, arguments: args })).json();
      return { err: !!j.error || !!j.result?.isError, out: j.result?.content?.[0]?.text };
    };
    await tool(writeKey, 'add_field', { collection: 'blog-posts', label: 'Polls', type: 'countermap', name: 'polls' });
    await tool(writeKey, 'add_field', { collection: 'blog-posts', label: 'Tiny', type: 'countermap', name: 'tiny', options: { maxKeys: 2 } });
    await tool(writeKey, 'add_field', { collection: 'blog-posts', label: 'Tally', type: 'countermap', name: 'tally', options: { access: 'key' } });
    for (const s of ['cm-demo', 'cm-empty']) {
      await tool(writeKey, 'create_entry', { collection: 'blog-posts', slug: s, data: { body: 'x' } });
      await tool(writeKey, 'publish_entry', { collection: 'blog-posts', slug: s });
    }
    const ep = `${base}/api/v1/${slug}/blog-posts/cm-demo`;
    const vote = (path: string, ua: string, headers: any = {}) =>
      fetch(`${ep}/counters/${path}`, { method: 'POST', headers: { 'User-Agent': ua, ...headers } });
    let r: any = await (await vote('polls/like', 'ua-a')).json();
    assert.deepEqual(r, { key: 'like', count: 1, changed: true }, 'public map vote creates the key');
    r = await (await vote('polls/like', 'ua-a')).json();
    assert.deepEqual(r, { key: 'like', count: 1, changed: false }, 'same visitor same key is a no-op');
    r = await (await vote('polls/like', 'ua-b')).json();
    assert.equal(r.count, 2, 'plain key counts each visitor once');
    r = await (await vote('polls/poll:yes', 'ua-a')).json();
    assert.deepEqual([r.count, r.changed], [1, true], 'group option vote counts');
    r = await (await vote('polls/poll:no', 'ua-a')).json();
    assert.deepEqual([r.key, r.count, r.changed], ['poll:no', 1, true], 'another option in the group counts');
    r = await (await vote('polls/poll:no', 'ua-a')).json();
    assert.equal(r.changed, false, 'same option again is a no-op');
    assert.equal((await vote('polls/bad%20key', 'ua-a')).status, 400, 'bad key grammar is 400');
    assert.equal((await vote(`polls/${'k'.repeat(65)}`, 'ua-a')).status, 400, 'over-long key is 400');
    assert.equal((await vote('likes/x', 'ua-a')).status, 404, 'counter field with a key segment is 404');
    assert.equal((await vote('polls', 'ua-a')).status, 404, 'countermap field without a key is 404');
    assert.equal((await vote('tiny/k1', 'ua-a')).status, 200, 'first key under maxKeys');
    assert.equal((await vote('tiny/k2', 'ua-a')).status, 200, 'second key under maxKeys');
    const full = await vote('tiny/k3', 'ua-a');
    assert.equal(full.status, 409, 'new key past maxKeys is 409');
    assert.match(String(((await full.json()) as any).message), /Key limit reached/, '409 body names the key limit');
    r = await (await vote('tiny/k1', 'ua-c')).json();
    assert.equal(r.count, 2, 'existing keys keep counting at the limit');
    assert.equal((await vote('tally/x', 'ua-a')).status, 401, 'private map rejects a keyless vote');
    assert.equal((await vote('tally/x', 'ua-a', { Authorization: `Bearer ${apiKey}` })).status, 403, 'private map rejects a read key');
    r = await (await vote('tally/x?by=5', 'ua-a', { Authorization: `Bearer ${writeKey}` })).json();
    assert.deepEqual(r, { key: 'x', count: 5 }, 'private map takes a step from a write key');
    r = await (await vote('tally/x?by=-9', 'ua-a', { Authorization: `Bearer ${writeKey}` })).json();
    assert.equal(r.count, 0, 'negative step floors at 0');
    const pubMap: any = await (await fetch(`${ep}/counters`)).json();
    const { likes, ...maps } = pubMap;
    assert.deepEqual(maps, {
      polls: { like: 2, 'poll:yes': 0, 'poll:no': 1 },
      tiny: { k1: 2, k2: 1 },
    }, 'switch moved the group vote; keyless read hides private maps');
    assert.deepEqual(Object.keys(likes), ['up', 'down'], 'counter field keeps its {up, down} shape beside maps');
    const privMap: any = await (await fetch(`${ep}/counters`, { headers: { Authorization: `Bearer ${apiKey}` } })).json();
    assert.deepEqual([privMap.tally, Object.keys(privMap.stars)], [{ x: 0 }, ['up', 'down']], 'keyed read includes private maps and counters');
    const bulk: any = await (await fetch(`${base}/api/v1/${slug}/blog-posts/counters?slugs=cm-demo,cm-empty`)).json();
    assert.deepEqual(bulk.items['cm-demo'], pubMap, 'bulk read matches the single read');
    assert.deepEqual(bulk.items['cm-empty'].polls, {}, 'empty map reads as {}');
    assert.equal((await fetch(`${ep}/counters/polls/like`, { method: 'OPTIONS' })).status, 204, 'map CORS preflight answers');
    const cmPayload = JSON.stringify(await (await fetch(ep, { headers: { Authorization: `Bearer ${apiKey}` } })).json());
    assert.ok(!cmPayload.includes('polls') && !cmPayload.includes('poll:'), 'map counts are not in the entry payload');
    const clamped = JSON.parse((await tool(writeKey, 'update_field', { collection: 'blog-posts', field: 'tiny', options: { maxKeys: 5000 } })).out);
    assert.equal(clamped.maxKeys, 1024, 'maxKeys above the cap clamps to 1024');
    const cmEditor = await (await req('GET', `/admin/projects/${slug}/collections/blog-posts/cm-demo`)).text();
    assert.ok(cmEditor.includes('Keyed counter map') && cmEditor.includes('up to 64'), 'entry editor shows the server-managed notice');
    const cmColl = await (await req('GET', `/admin/projects/${slug}/collections/blog-posts`)).text();
    assert.ok(cmColl.includes('name="maxKeys"') && cmColl.includes('<option value="countermap"'), 'field editor offers countermap and maxKeys');
    await tool(writeKey, 'delete_entry', { collection: 'blog-posts', slug: 'cm-empty' });
    await tool(writeKey, 'delete_entry', { collection: 'blog-posts', slug: 'cm-demo' });
  }

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
  assert.ok(existsSync(path.join(dataDir, 'media', slug)), 'local media files should be kept without explicit confirmation');

  // 16. Opt-in media wipe on project delete: unreferenced local files go,
  // files another project still references stay.
  const mkProbe = await req('POST', '/admin/projects', { form: { name: 'Media Probe' } });
  assert.equal(mkProbe.status, 302, 'probe project creation should redirect');
  assert.ok(getProjectBySlug(app.coreDb, 'media-probe'), 'probe project should exist');
  const probeDir = path.join(dataDir, 'media', 'media-probe');
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(path.join(probeDir, 'ab12cd34-shared.png'), 'shared');
  writeFileSync(path.join(probeDir, 'zz99yy88-orphan.png'), 'orphan');

  const mkRef = await req('POST', '/admin/projects', { form: { name: 'Media Referrer' } });
  assert.equal(mkRef.status, 302, 'referrer project creation should redirect');
  assert.ok(getProjectBySlug(app.coreDb, 'media-referrer'), 'referrer project should exist');
  {
    const rdb: any = new DatabaseSync(path.join(dataDir, 'projects', 'media-referrer.db'));
    const col: any = rdb.prepare("INSERT INTO collections (slug, name, fields) VALUES ('c', 'C', '[]')").run();
    rdb.prepare('INSERT INTO entries (collection_id, slug, status, data) VALUES (?, ?, ?, ?)')
      .run(col.lastInsertRowid, 'e1', 'draft', JSON.stringify({ body: '![pic](/media/media-probe/ab12cd34-shared.png)' }));
    rdb.close();
  }

  const probeDelete = await req('POST', '/admin/projects/media-probe/delete', {
    form: { confirm: 'media-probe', delete_media: '1' },
  });
  assert.equal(probeDelete.status, 302, 'opt-in media delete should redirect');
  assert.ok(!existsSync(path.join(probeDir, 'zz99yy88-orphan.png')), 'unreferenced file should be deleted');
  assert.ok(existsSync(path.join(probeDir, 'ab12cd34-shared.png')), 'file used by another project should be kept');
  assert.ok(existsSync(probeDir), 'media dir with kept files should remain');
  assert.equal(getProjectBySlug(app.coreDb, 'media-probe'), null, 'probe project row should be gone from core.db');

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
  if (webhookServer) {
    await new Promise((resolve) => webhookServer.close(resolve));
  }
  app.closeAll();
  await new Promise((resolve) => app.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
}
