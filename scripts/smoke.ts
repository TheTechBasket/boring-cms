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

  // 9. Publish, then read through the public API with a Bearer key
  const publishRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}/publish`);
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
  assert.equal(list.items[0].slug, entrySlug);
  assert.equal(list.items[0].body, '# Second draft', 'published snapshot should carry the field value');

  const single = await fetch(`${base}/api/v1/${slug}/blog-posts/${entrySlug}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  assert.equal(((await single.json()) as any).body, '# Second draft');

  const cached = await fetch(`${base}/api/v1/${slug}/blog-posts`, { headers: { Authorization: `Bearer ${apiKey}`, 'If-None-Match': etag } });
  assert.equal(cached.status, 304, 'matching If-None-Match should be a 304');

  // 10. Atomic revert to the first revision
  const revertRes = await req('POST', `/admin/projects/${slug}/collections/blog-posts/${entrySlug}/revert`, {
    form: { revision_id: String(revisions[0].id) },
  });
  assert.equal(revertRes.status, 302, 'revert should redirect');
  entry = getEntry(projectDb, collection.id, entrySlug);
  assert.equal(entry.data.body, '# First draft', 'revert should restore the previous field value');

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

  const { writeFileSync: wf, unlinkSync: ul } = await import('node:fs');
  const strayPath = path.join(dataDir, 'media', slug, 'deadbeef-stray.txt');
  wf(strayPath, 'outside upload');
  const syncRes = await req('POST', `/admin/projects/${slug}/media/sync`);
  assert.equal(syncRes.status, 200, 'sync should render a report');
  const syncHtml = await syncRes.text();
  assert.ok(syncHtml.includes('deadbeef-stray.txt'), 'sync should adopt the outside file as a media row');
  assert.ok(syncHtml.includes('1 adopted'), 'sync report should count the adoption');

  ul(strayPath);
  const sync2Html = await (await req('POST', `/admin/projects/${slug}/media/sync`)).text();
  assert.ok(sync2Html.includes('1 missing') || sync2Html.includes('missing&quot;: [\n    &quot;deadbeef'), 'sync should flag the row whose file is gone');

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
  assert.ok(init.result.serverInfo.name.includes('yncms'), 'initialize should name the server');

  const readTools: any = await (await rpc(apiKey, 'tools/list')).json();
  const readNames = readTools.result.tools.map((t) => t.name);
  assert.ok(readNames.includes('list_collections'), 'read key should see read tools');
  assert.ok(!readNames.includes('create_entry'), 'read key should not see write tools');

  const writeDenied: any = await (
    await rpc(apiKey, 'tools/call', { name: 'create_entry', arguments: { collection: 'blog-posts', data: {} } })
  ).json();
  assert.ok(writeDenied.error.message.includes('read-only'), 'write tool with read key should be refused');

  const writeKeyPage = await req('POST', `/admin/projects/${slug}/api-keys`, { form: { name: 'agent', scope: 'write' } });
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

  let limited = false;
  for (let i = 0; i < 70; i++) {
    if ((await rpc(apiKey, 'ping')).status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'per-key rate limit should kick in');

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

  const badPw = await req('POST', '/account/password', { form: { current_password: 'wrong', password: 'newpassword1', password_confirm: 'newpassword1' } });
  assert.equal(badPw.status, 400, 'wrong current password should be rejected');

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

  // Passkey removal from the account page.
  const credRow = app.coreDb.prepare('SELECT id FROM credentials').get();
  await req('POST', `/account/passkeys/${credRow.id}/delete`);
  assert.equal(app.coreDb.prepare('SELECT COUNT(*) AS n FROM credentials').get().n, 0, 'passkey removal should delete the row');

  // 15. Delete the project (requires exact slug confirmation)
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
