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

  // 13. Delete the project (requires exact slug confirmation)
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
