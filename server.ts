import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './lib/config.ts';
import { openCoreDb, ProjectDbManager } from './lib/db.ts';
import {
  userCount,
  getUserByEmail,
  getUserById,
  createUser,
  verifyUserPassword,
  setUserPassword,
  createSession,
  getSession,
  deleteSession,
  isValidSlug,
  listProjects,
  getProjectBySlug,
  createProject,
  renameProject,
  deleteProjectRow,
  setSetting,
  listSettingKeys,
  getSettingValue,
} from './lib/store.ts';
import { readMultipart } from './lib/multipart.ts';
import { exportSchema, exportCollection, exportProject, applySchema, parseImportFile, applyImport } from './lib/transfer.ts';
import { localBackend, s3Backend } from './lib/storage.ts';
import { listMedia, createMedia, deleteMedia, findServableMedia, registerMedia, syncMedia, mediaUsage, mediaKeyFor, hasSharp } from './lib/media.ts';
import { signValue, verifySignedValue } from './lib/crypto.ts';
import { Router, readBody, readFormBody, parseCookies, setCookie, clearCookie } from './lib/router.ts';
import { handleMcp, rateLimitOk } from './lib/mcp.ts';
import {
  FIELD_TYPES,
  contentVersion,
  listCollections,
  getCollection,
  createCollection,
  addCollectionField,
  updateCollectionField,
  removeCollectionField,
  validateEntryData,
  reorderCollectionFields,
  deleteCollection,
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  publishEntry,
  unpublishEntry,
  deleteEntry,
  listRevisions,
  revertToRevision,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  verifyApiKey,
  listPublished,
  getPublished,
  slugify,
  uniqueSlug,
} from './lib/content.ts';
import {
  setupPage,
  loginPage,
  resetPasswordPage,
  projectListPage,
  projectDetailPage,
  globalSettingsPage,
  collectionsPage,
  collectionPage,
  entryEditorPage,
  apiKeysPage,
  mediaPage,
  transferPage,
  importMappingPage,
  importReportPage,
  errorPage,
} from './lib/views.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = 'yn_session';

export function createApp(configOverrides = {}) {
  const config = { ...loadConfig(__dirname), ...configOverrides };
  if (!config.masterKey || config.masterKey.length < 32) {
    const suggested = randomBytes(32).toString('base64url');
    throw new Error(
      'SECRET_KEY missing or shorter than 32 characters. yncms refuses to start without it.\n' +
        `Suggested key, paste this line into .env:\n\nSECRET_KEY=${suggested}\n\n` +
        'Changing it later makes existing encrypted settings unreadable. (MASTER_KEY is accepted as a legacy alias.)',
    );
  }
  const migrationsDir = path.join(__dirname, 'migrations');
  const coreDb = openCoreDb(config.dataDir, migrationsDir);
  const projectDbs = new ProjectDbManager(config.dataDir, {
    migrationsDir: path.join(migrationsDir, 'project'),
    onSlowQuery: (dbName, sql, ms) => {
      try {
        coreDb.prepare('INSERT INTO slow_queries (db, sql, duration_ms) VALUES (?, ?, ?)').run(dbName, sql, ms);
      } catch {
        // best effort
      }
    },
  });

  if (config.forcePasswordReset) {
    coreDb.exec('UPDATE users SET must_reset_password = 1');
  }

  const router = new Router();
  const publicDir = path.join(__dirname, 'public');

  function send(req, res, status, body, headers = {}) {
    const ms = performance.now() - req._start;
    res.setHeader('Server-Timing', `total;dur=${ms.toFixed(2)}`);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.writeHead(status);
    res.end(body);
  }

  function html(req, res, status, body) {
    send(req, res, status, body, { 'Content-Type': 'text/html; charset=utf-8' });
  }

  function redirect(req, res, location) {
    send(req, res, 302, '', { Location: location });
  }

  function currentUser(req) {
    const cookies = parseCookies(req);
    const signed = cookies[SESSION_COOKIE];
    if (!signed) return null;
    const sessionId = verifySignedValue(config.masterKey, signed);
    if (!sessionId) return null;
    const session = getSession(coreDb, sessionId);
    if (!session) return null;
    return getUserById(coreDb, session.user_id);
  }

  function loginUser(req, res, userId) {
    const sessionId = createSession(coreDb, userId);
    setCookie(res, SESSION_COOKIE, signValue(config.masterKey, sessionId), {
      maxAgeSeconds: 30 * 24 * 60 * 60,
    });
  }

  // ---- Auth / setup routes ----------------------------------------------

  router.get('/setup', (req, res) => {
    if (userCount(coreDb) > 0) return redirect(req, res, '/login');
    html(req, res, 200, setupPage());
  });

  router.post('/setup', async (req, res) => {
    if (userCount(coreDb) > 0) return redirect(req, res, '/login');
    const form = await readFormBody(req);
    const email = (form.email || '').trim().toLowerCase();
    const password = form.password || '';
    const confirm = form.password_confirm || '';
    if (!email || password.length < 8) {
      return html(req, res, 400, setupPage({ error: 'Enter an email and a password of at least 8 characters.' }));
    }
    if (password !== confirm) {
      return html(req, res, 400, setupPage({ error: 'Passwords do not match.' }));
    }
    const user = await createUser(coreDb, { email, password });
    loginUser(req, res, user.id);
    redirect(req, res, '/admin/projects');
  });

  router.get('/login', (req, res) => {
    if (userCount(coreDb) === 0) return redirect(req, res, '/setup');
    if (currentUser(req)) return redirect(req, res, '/admin/projects');
    html(req, res, 200, loginPage());
  });

  router.post('/login', async (req, res) => {
    if (userCount(coreDb) === 0) return redirect(req, res, '/setup');
    const form = await readFormBody(req);
    const email = (form.email || '').trim().toLowerCase();
    const password = form.password || '';
    const user = getUserByEmail(coreDb, email);
    const ok = user && (await verifyUserPassword(user, password));
    if (!ok) {
      return html(req, res, 401, loginPage({ error: 'Incorrect email or password.' }));
    }
    loginUser(req, res, user.id);
    if (user.must_reset_password) return redirect(req, res, '/reset-password');
    redirect(req, res, '/admin/projects');
  });

  router.post('/logout', (req, res) => {
    const cookies = parseCookies(req);
    const signed = cookies[SESSION_COOKIE];
    const sessionId = signed ? verifySignedValue(config.masterKey, signed) : null;
    if (sessionId) deleteSession(coreDb, sessionId);
    clearCookie(res, SESSION_COOKIE);
    redirect(req, res, '/login');
  });

  router.get('/reset-password', (req, res) => {
    const user = currentUser(req);
    if (!user) return redirect(req, res, '/login');
    html(req, res, 200, resetPasswordPage());
  });

  router.post('/reset-password', async (req, res) => {
    const user = currentUser(req);
    if (!user) return redirect(req, res, '/login');
    const form = await readFormBody(req);
    const password = form.password || '';
    const confirm = form.password_confirm || '';
    if (password.length < 8) {
      return html(req, res, 400, resetPasswordPage({ error: 'Password must be at least 8 characters.' }));
    }
    if (password !== confirm) {
      return html(req, res, 400, resetPasswordPage({ error: 'Passwords do not match.' }));
    }
    await setUserPassword(coreDb, user.id, password, { mustResetPassword: false });
    redirect(req, res, '/admin/projects');
  });

  // ---- Admin routes (session-guarded) ------------------------------------

  function requireAdmin(handler) {
    return async (req, res, params) => {
      const user = currentUser(req);
      if (!user) return redirect(req, res, '/login');
      if (user.must_reset_password) return redirect(req, res, '/reset-password');
      return handler(req, res, params, user);
    };
  }

  router.get(
    '/admin/projects',
    requireAdmin((req, res, params, user) => {
      html(req, res, 200, projectListPage({ user, projects: listProjects(coreDb) }));
    }),
  );

  router.post(
    '/admin/projects',
    requireAdmin(async (req, res, params, user) => {
      const form = await readFormBody(req);
      const name = (form.name || '').trim();
      if (!name) {
        return html(
          req,
          res,
          400,
          projectListPage({
            user,
            projects: listProjects(coreDb),
            notice: { type: 'error', message: 'Enter a project name.' },
          }),
        );
      }
      const slug = uniqueSlug(slugify(name), (s) => !!getProjectBySlug(coreDb, s));
      createProject(coreDb, { slug, name });
      projectDbs.get(slug); // create the project DB file now
      redirect(req, res, '/admin/projects');
    }),
  );

  router.get(
    '/admin/projects/:slug',
    requireAdmin((req, res, params, user) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const settingKeys = listSettingKeys(coreDb, { scope: 'project', projectId: project.id });
      html(req, res, 200, projectDetailPage({ user, projects: listProjects(coreDb), project, settingKeys }));
    }),
  );

  router.post(
    '/admin/projects/:slug/rename',
    requireAdmin(async (req, res, params) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const form = await readFormBody(req);
      const name = (form.name || '').trim();
      if (name) renameProject(coreDb, project.slug, name);
      redirect(req, res, `/admin/projects/${project.slug}`);
    }),
  );

  router.post(
    '/admin/projects/:slug/settings',
    requireAdmin(async (req, res, params) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const form = await readFormBody(req);
      const key = (form.key || '').trim();
      const value = form.value || '';
      if (key && value) {
        setSetting(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key, value });
      }
      redirect(req, res, `/admin/projects/${project.slug}`);
    }),
  );

  router.post(
    '/admin/projects/:slug/delete',
    requireAdmin(async (req, res, params, user) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const form = await readFormBody(req);
      if (form.confirm !== project.slug) {
        const settingKeys = listSettingKeys(coreDb, { scope: 'project', projectId: project.id });
        return html(
          req,
          res,
          400,
          projectDetailPage({
            user,
            projects: listProjects(coreDb),
            project,
            settingKeys,
            notice: { type: 'error', message: 'Type the project slug exactly to confirm deletion.' },
          }),
        );
      }
      projectDbs.destroy(project.slug);
      deleteProjectRow(coreDb, project.slug);
      redirect(req, res, '/admin/projects');
    }),
  );

  router.get(
    '/admin/settings',
    requireAdmin((req, res, params, user) => {
      html(req, res, 200, globalSettingsPage({ user, projects: listProjects(coreDb), settingKeys: listSettingKeys(coreDb, { scope: 'global' }) }));
    }),
  );

  router.post(
    '/admin/settings',
    requireAdmin(async (req, res, params, user) => {
      const form = await readFormBody(req);
      const key = (form.key || '').trim();
      const value = form.value || '';
      if (key && value) {
        setSetting(coreDb, config.masterKey, { scope: 'global', key, value });
      }
      redirect(req, res, '/admin/settings');
    }),
  );

  // ---- Content (collections, entries, revisions) -------------------------

  // Wraps requireAdmin and resolves the project + its DB from :slug.
  function withProject(handler) {
    return requireAdmin((req, res, params, user) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const db = projectDbs.get(project.slug);
      const ctx = { user, projects: listProjects(coreDb), project };
      return handler(req, res, params, ctx, db);
    });
  }

  function collectFieldValues(collection, form) {
    const data = {};
    for (const f of collection.fields) {
      const raw = form[`field_${f.name}`];
      if (f.type === 'boolean') data[f.name] = raw === '1';
      else if (f.type === 'number') data[f.name] = raw === '' || raw === undefined ? null : Number(raw);
      else if (f.type === 'json') {
        // Store parsed JSON when valid so the API serves real structures;
        // keep the raw string otherwise instead of losing the input.
        try { data[f.name] = raw ? JSON.parse(raw) : null; } catch { data[f.name] = raw; }
      }
      else data[f.name] = raw ?? '';
    }
    return data;
  }

  function projectStats(db) {
    const entries = db.prepare("SELECT COUNT(*) AS total, SUM(status = 'published') AS published FROM entries").get();
    const keys = db.prepare('SELECT COUNT(*) AS total FROM api_keys').get();
    return { entries: entries.total || 0, published: entries.published || 0, apiKeys: keys.total || 0 };
  }

  router.get('/admin/projects/:slug/collections', withProject((req, res, params, ctx, db) => {
    html(req, res, 200, collectionsPage({ ...ctx, collections: listCollections(db), stats: projectStats(db) }));
  }));

  router.post('/admin/projects/:slug/collections', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const name = (form.name || '').trim();
    if (!name) {
      return html(req, res, 400, collectionsPage({ ...ctx, collections: listCollections(db), stats: projectStats(db), notice: { type: 'error', message: 'Enter a collection name.' } }));
    }
    const collection = createCollection(db, name);
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${collection.slug}`);
  }));

  // ---- Media --------------------------------------------------------------

  // Backend chosen per project from encrypted settings; local disk default.
  function mediaBackendFor(project) {
    const setting = (key) =>
      getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key });
    if (setting('media_backend') === 's3') {
      return s3Backend({
        endpoint: setting('s3_endpoint'),
        bucket: setting('s3_bucket'),
        region: setting('s3_region') || 'auto',
        accessKey: setting('s3_key'),
        secretKey: setting('s3_secret'),
        publicUrl: setting('s3_public_url'),
      });
    }
    return localBackend(path.join(config.dataDir, 'media', project.slug));
  }

  function mediaCtx(ctx, db) {
    const setting = (key) => getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: ctx.project.id, key });
    const isS3 = setting('media_backend') === 's3';
    const media = listMedia(db);
    // Per-image "where used": a plain scan, no stored relationships.
    const usage = Object.fromEntries(media.map((m) => [m.key, mediaUsage(db, m.key)]));
    return {
      ...ctx,
      media,
      usage,
      publicBase: isS3 ? setting('s3_public_url') || null : null,
      variantsMode: setting('media_variants') || '',
      hasSharp,
      directUpload: isS3,
    };
  }

  router.get('/admin/projects/:slug/media', withProject((req, res, params, ctx, db) => {
    html(req, res, 200, mediaPage(mediaCtx(ctx, db)));
  }));

  router.post('/admin/projects/:slug/media', withProject(async (req, res, params, ctx, db) => {
    let upload;
    try {
      upload = await readMultipart(req);
    } catch (err) {
      return html(req, res, 400, mediaPage({ ...mediaCtx(ctx, db), notice: { type: 'error', message: err.message } }));
    }
    const file = upload.files.file;
    if (!file) {
      return html(req, res, 400, mediaPage({ ...mediaCtx(ctx, db), notice: { type: 'error', message: 'Choose a file to upload.' } }));
    }
    await createMedia(db, mediaBackendFor(ctx.project), file, { withVariants: upload.fields.variants === '1' });
    redirect(req, res, `/admin/projects/${ctx.project.slug}/media`);
  }));

  // Presigned browser-to-bucket upload: sign, let the browser PUT, then
  // register the row. Bytes never pass through the server.
  router.post('/admin/projects/:slug/media/presign', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const backend = mediaBackendFor(ctx.project);
    if (!/^[0-9a-f]{64}$/.test(form.hash || '') || !form.filename) {
      return json(req, res, 400, { error: 'hash (sha256 hex) and filename required' });
    }
    const { key } = mediaKeyFor(form.hash, form.filename);
    const url = backend.presignPut(key, form.mime || 'application/octet-stream');
    if (!url) return json(req, res, 400, { error: 'Direct upload needs the S3 backend.' });
    json(req, res, 200, { url, key });
  }));

  router.post('/admin/projects/:slug/media/register', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    if (!/^[A-Za-z0-9._-]+$/.test(form.key || '') || !form.filename) {
      return json(req, res, 400, { error: 'key and filename required' });
    }
    const media = registerMedia(db, {
      filename: form.filename,
      key: form.key,
      mime: form.mime || 'application/octet-stream',
      size: Number(form.size) || 0,
      width: Number(form.width) || null,
      height: Number(form.height) || null,
    });
    json(req, res, 200, { id: media.id, key: media.key });
  }));

  router.post('/admin/projects/:slug/media/sync', withProject(async (req, res, params, ctx, db) => {
    let report;
    try {
      report = await syncMedia(db, mediaBackendFor(ctx.project));
    } catch (err) {
      return html(req, res, 400, mediaPage({ ...mediaCtx(ctx, db), notice: { type: 'error', message: err.message } }));
    }
    const summary = `${report.adopted.length} adopted, ${report.missing.length} missing of ${report.total} objects.`;
    html(req, res, 200, mediaPage({ ...mediaCtx(ctx, db), report, notice: { type: 'success', message: `Storage synced: ${summary}` } }));
  }));

  router.post('/admin/projects/:slug/media/:id/delete', withProject(async (req, res, params, ctx, db) => {
    await deleteMedia(db, mediaBackendFor(ctx.project), Number(params.id));
    redirect(req, res, `/admin/projects/${ctx.project.slug}/media`);
  }));

  // Public serve route. Keys are content-hashed, so responses are immutable.
  router.get('/media/:slug/:key', async (req, res, params) => {
    const project = getProjectBySlug(coreDb, params.slug);
    if (!project || !/^[A-Za-z0-9._-]+$/.test(params.key)) {
      return send(req, res, 404, 'Not found');
    }
    const db = projectDbs.get(project.slug);
    const found = findServableMedia(db, params.key);
    if (!found) return send(req, res, 404, 'Not found');
    const backend = mediaBackendFor(project);
    const publicUrl = backend.publicUrl(params.key);
    if (publicUrl) return redirect(req, res, publicUrl);
    const stream = await backend.stream(params.key);
    if (!stream) return send(req, res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': found.media.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    stream.pipe(res);
  });

  // Resolves the collection too.
  function withCollection(handler) {
    return withProject((req, res, params, ctx, db) => {
      const collection = getCollection(db, params.cslug);
      if (!collection) return html(req, res, 404, errorPage({ status: 404, message: 'Collection not found.' }));
      return handler(req, res, params, { ...ctx, collection }, db);
    });
  }

  router.get('/admin/projects/:slug/collections/:cslug', withCollection((req, res, params, ctx, db) => {
    html(req, res, 200, collectionPage({ ...ctx, entries: listEntries(db, ctx.collection.id), fieldTypes: FIELD_TYPES }));
  }));

  router.post('/admin/projects/:slug/collections/:cslug/fields/add', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const label = (form.label || '').trim();
    const type = FIELD_TYPES.includes(form.type) ? form.type : 'text';
    if (label) addCollectionField(db, ctx.collection.slug, { label, type });
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}`);
  }));

  router.post('/admin/projects/:slug/collections/:cslug/fields/update', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    if (form.field) {
      // Checkboxes send nothing when unchecked, so required maps explicitly.
      updateCollectionField(db, ctx.collection.slug, form.field, { ...form, required: form.required === '1' });
    }
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}`);
  }));

  router.post('/admin/projects/:slug/collections/:cslug/fields/reorder', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const order = (form.order || '').split(',').filter(Boolean);
    if (order.length) reorderCollectionFields(db, ctx.collection.slug, order);
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}`);
  }));

  router.post('/admin/projects/:slug/collections/:cslug/fields/remove', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    if (form.field) removeCollectionField(db, ctx.collection.slug, form.field);
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}`);
  }));

  router.post('/admin/projects/:slug/collections/:cslug/delete', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    if (form.confirm !== ctx.collection.slug) {
      return html(req, res, 400, collectionPage({ ...ctx, entries: listEntries(db, ctx.collection.id), fieldTypes: FIELD_TYPES, notice: { type: 'error', message: 'Type the collection slug exactly to confirm deletion.' } }));
    }
    deleteCollection(db, ctx.collection.slug);
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections`);
  }));

  // ---- Transfer: export/import + schema-as-code ---------------------------

  const importTmpDir = path.join(config.dataDir, 'tmp');

  function transferCtx(ctx, db) {
    return { ...ctx, collections: listCollections(db), fieldTypes: FIELD_TYPES };
  }

  router.get('/admin/projects/:slug/transfer', withProject((req, res, params, ctx, db) => {
    html(req, res, 200, transferPage(transferCtx(ctx, db)));
  }));

  router.get('/admin/projects/:slug/schema.json', withProject((req, res, params, ctx, db) => {
    json(req, res, 200, exportSchema(db), { 'Content-Disposition': `attachment; filename="${ctx.project.slug}-schema.json"` });
  }));

  router.get('/admin/projects/:slug/export.json', withProject((req, res, params, ctx, db) => {
    json(req, res, 200, exportProject(db, ctx.project), { 'Content-Disposition': `attachment; filename="${ctx.project.slug}-export.json"` });
  }));

  router.get('/admin/projects/:slug/collections/:cslug/export.json', withCollection((req, res, params, ctx, db) => {
    json(req, res, 200, exportCollection(db, ctx.collection), { 'Content-Disposition': `attachment; filename="${ctx.collection.slug}-export.json"` });
  }));

  router.post('/admin/projects/:slug/schema/apply', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    let report;
    try {
      report = applySchema(db, JSON.parse(form.schema || ''), { deleteMissing: form.delete_missing === '1' });
    } catch (err) {
      return html(req, res, 400, transferPage({ ...transferCtx(ctx, db), notice: { type: 'error', message: err instanceof SyntaxError ? 'Schema is not valid JSON.' : err.message } }));
    }
    html(req, res, 200, transferPage({ ...transferCtx(ctx, db), report, notice: { type: 'success', message: 'Schema applied.' } }));
  }));

  router.post('/admin/projects/:slug/import', withProject(async (req, res, params, ctx, db) => {
    let upload;
    try { upload = await readMultipart(req); } catch (err) {
      return html(req, res, 400, transferPage({ ...transferCtx(ctx, db), notice: { type: 'error', message: err.message } }));
    }
    const file = upload.files.file;
    const collection = getCollection(db, upload.fields.collection || '');
    if (!file || !collection) {
      return html(req, res, 400, transferPage({ ...transferCtx(ctx, db), notice: { type: 'error', message: 'Choose a file and a target collection.' } }));
    }
    let parsed;
    try { parsed = parseImportFile(file.filename, file.data); } catch (err) {
      return html(req, res, 400, transferPage({ ...transferCtx(ctx, db), notice: { type: 'error', message: err.message } }));
    }
    // Pending state lives in a temp file, not memory: a restart mid-flow
    // costs nothing, and stale files are plain JSON anyone can delete.
    const importId = randomUUID();
    mkdirSync(importTmpDir, { recursive: true });
    writeFileSync(path.join(importTmpDir, `${importId}.json`), JSON.stringify({ collection: collection.slug, ...parsed }));
    html(req, res, 200, importMappingPage({ ...ctx, collection, importId, sourceFields: parsed.sourceFields, rowCount: parsed.rows.length, fieldTypes: FIELD_TYPES }));
  }));

  function readPendingImport(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const file = path.join(importTmpDir, `${id}.json`);
    if (!existsSync(file)) return null;
    return { file, ...JSON.parse(readFileSync(file, 'utf8')) };
  }

  function mappingFromForm(form, sourceFields) {
    const mapping = {};
    sourceFields.forEach((s, i) => {
      if (form[`src_${i}`] === s) mapping[s] = form[`map_${i}`] || 'skip';
    });
    return mapping;
  }

  for (const [step, dryRun] of [['check', true], ['apply', false]] as Array<[string, boolean]>) {
    router.post(`/admin/projects/:slug/import/:id/${step}`, withProject(async (req, res, params, ctx, db) => {
      const pending = readPendingImport(params.id);
      const collection = pending && getCollection(db, pending.collection);
      if (!pending || !collection) {
        return html(req, res, 404, transferPage({ ...transferCtx(ctx, db), notice: { type: 'error', message: 'Import session not found. Upload the file again.' } }));
      }
      const form = await readFormBody(req);
      let report;
      try {
        report = applyImport(db, collection.slug, pending.rows, mappingFromForm(form, pending.sourceFields), form.unique || '', { dryRun });
      } catch (err) {
        return html(req, res, 400, importMappingPage({ ...ctx, collection, importId: params.id, sourceFields: pending.sourceFields, rowCount: pending.rows.length, fieldTypes: FIELD_TYPES, notice: { type: 'error', message: err.message } }));
      }
      if (dryRun) {
        return html(req, res, 200, importReportPage({ ...ctx, collection, importId: params.id, report, form }));
      }
      unlinkSync(pending.file);
      html(req, res, 200, transferPage({ ...transferCtx(ctx, db), report, notice: { type: 'success', message: `Imported ${report.created + report.updated} of ${report.total} rows into ${collection.name}.` } }));
    }));
  }

  router.get('/admin/projects/:slug/collections/:cslug/new', withCollection((req, res, params, ctx, db) => {
    html(req, res, 200, entryEditorPage({ ...ctx, entry: null, media: listMedia(db) }));
  }));

  router.post('/admin/projects/:slug/collections/:cslug/new', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const data = collectFieldValues(ctx.collection, form);
    const errors = validateEntryData(ctx.collection, data);
    if (errors.length) {
      return html(req, res, 400, entryEditorPage({ ...ctx, entry: null, draft: data, media: listMedia(db), notice: { type: 'error', message: errors.join(' ') } }));
    }
    const entry = createEntry(db, ctx.collection, { data });
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}/${entry.slug}`);
  }));

  function withEntry(handler) {
    return withCollection((req, res, params, ctx, db) => {
      const entry = getEntry(db, ctx.collection.id, params.eslug);
      if (!entry) return html(req, res, 404, errorPage({ status: 404, message: 'Entry not found.' }));
      return handler(req, res, params, { ...ctx, entry }, db);
    });
  }

  router.get('/admin/projects/:slug/collections/:cslug/:eslug', withEntry((req, res, params, ctx, db) => {
    html(req, res, 200, entryEditorPage({ ...ctx, revisions: listRevisions(db, ctx.entry.id), media: listMedia(db) }));
  }));

  router.post('/admin/projects/:slug/collections/:cslug/:eslug', withEntry(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const data = collectFieldValues(ctx.collection, form);
    const errors = validateEntryData(ctx.collection, data);
    if (errors.length) {
      return html(req, res, 400, entryEditorPage({ ...ctx, entry: { ...ctx.entry, data }, revisions: listRevisions(db, ctx.entry.id), media: listMedia(db), notice: { type: 'error', message: errors.join(' ') } }));
    }
    updateEntry(db, ctx.entry, { data });
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}/${ctx.entry.slug}`);
  }));

  const entryActions: Array<[string, (db: any, ctx: any) => void]> = [
    ['publish', (db, ctx) => publishEntry(db, ctx.entry.id)],
    ['unpublish', (db, ctx) => unpublishEntry(db, ctx.entry.id)],
  ];
  for (const [actionName, fn] of entryActions) {
    router.post(`/admin/projects/:slug/collections/:cslug/:eslug/${actionName}`, withEntry(async (req, res, params, ctx, db) => {
      fn(db, ctx);
      redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}/${ctx.entry.slug}`);
    }));
  }

  router.post('/admin/projects/:slug/collections/:cslug/:eslug/delete', withEntry(async (req, res, params, ctx, db) => {
    deleteEntry(db, ctx.entry.id);
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}`);
  }));

  router.post('/admin/projects/:slug/collections/:cslug/:eslug/revert', withEntry(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const revisionId = Number.parseInt(form.revision_id, 10);
    try {
      revertToRevision(db, ctx.entry, revisionId);
    } catch (err) {
      return html(req, res, 400, entryEditorPage({ ...ctx, revisions: listRevisions(db, ctx.entry.id), notice: { type: 'error', message: err.message } }));
    }
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}/${ctx.entry.slug}`);
  }));

  // ---- API keys -----------------------------------------------------------

  router.get('/admin/projects/:slug/api-keys', withProject((req, res, params, ctx, db) => {
    html(req, res, 200, apiKeysPage({ ...ctx, keys: listApiKeys(db) }));
  }));

  router.post('/admin/projects/:slug/api-keys', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const name = (form.name || '').trim();
    if (!name) return redirect(req, res, `/admin/projects/${ctx.project.slug}/api-keys`);
    const createdKey = createApiKey(db, name, form.scope);
    html(req, res, 200, apiKeysPage({ ...ctx, keys: listApiKeys(db), createdKey }));
  }));

  router.post('/admin/projects/:slug/api-keys/:keyId/revoke', withProject(async (req, res, params, ctx, db) => {
    revokeApiKey(db, Number.parseInt(params.keyId, 10));
    redirect(req, res, `/admin/projects/${ctx.project.slug}/api-keys`);
  }));

  // ---- Public content API (hot path: no sessions, Bearer key only) --------

  function json(req, res, status, payload, headers = {}) {
    send(req, res, status, JSON.stringify(payload), { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  }

  function apiHandler(handler) {
    return (req, res, params) => {
      const project = getProjectBySlug(coreDb, params.project);
      if (!project) return json(req, res, 404, { error: 'not_found' });
      const db = projectDbs.get(project.slug);
      const auth = req.headers.authorization || '';
      const key = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (!verifyApiKey(db, key)) return json(req, res, 401, { error: 'unauthorized' });

      // ETag from the project's content version: publish bumps it, so
      // repeat static-site builds get 304s without touching entries.
      const etag = `"v${contentVersion(db)}"`;
      if (req.headers['if-none-match'] === etag) return send(req, res, 304, '', { ETag: etag });

      const collection = getCollection(db, params.collection);
      if (!collection) return json(req, res, 404, { error: 'not_found' });
      return handler(req, res, params, { db, collection, etag });
    };
  }

  router.get('/api/v1/:project/:collection', apiHandler((req, res, params, { db, collection, etag }) => {
    const url = new URL(req.url, 'http://localhost');
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;
    json(req, res, 200, { items: listPublished(db, collection.id, { limit, offset }) }, { ETag: etag });
  }));

  router.get('/api/v1/:project/:collection/:entry', apiHandler((req, res, params, { db, collection, etag }) => {
    const item = getPublished(db, collection.id, params.entry);
    if (!item) return json(req, res, 404, { error: 'not_found' });
    json(req, res, 200, item, { ETag: etag });
  }));

  // ---- MCP endpoint (per project, Bearer key, JSON-RPC over POST) ---------

  router.post('/mcp/:project', async (req, res, params) => {
    const project = getProjectBySlug(coreDb, params.project);
    if (!project) return json(req, res, 404, { error: 'not_found' });
    const db = projectDbs.get(project.slug);
    const auth = req.headers.authorization || '';
    const apiKey = verifyApiKey(db, auth.startsWith('Bearer ') ? auth.slice(7) : null);
    if (!apiKey) return json(req, res, 401, { error: 'unauthorized' });
    if (!rateLimitOk(`${project.slug}:${apiKey.id}`)) {
      return json(req, res, 429, { error: 'rate_limited' }, { 'Retry-After': '60' });
    }
    let message;
    try {
      message = JSON.parse(await readBody(req));
    } catch {
      return json(req, res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } });
    }
    const response = handleMcp(db, project.name, message, apiKey.scope);
    if (response === null) return send(req, res, 202, '', {});
    json(req, res, 200, response);
  });

  // ---- Static files -------------------------------------------------------

  function serveStatic(req, res, pathname) {
    const rel = pathname.replace(/^\/public\//, '');
    if (rel.includes('..')) return html(req, res, 400, errorPage({ status: 400, message: 'Bad request.' }));
    const filePath = path.join(publicDir, rel);
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return html(req, res, 404, errorPage({ status: 404, message: 'Not found.' }));
    }
    const ext = path.extname(filePath);
    const type = { '.css': 'text/css', '.js': 'application/javascript' }[ext] || 'application/octet-stream';
    const ms = performance.now() - req._start;
    res.setHeader('Server-Timing', `total;dur=${ms.toFixed(2)}`);
    res.setHeader('Content-Type', type);
    res.writeHead(200);
    createReadStream(filePath).pipe(res);
  }

  // ---- Dispatch -------------------------------------------------------------

  const server: any = http.createServer((req: any, res) => {
    req._start = performance.now();
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (pathname.startsWith('/public/')) {
      return serveStatic(req, res, pathname);
    }

    // First-run gate: no admin user yet, everything (except /setup) goes there.
    if (userCount(coreDb) === 0 && pathname !== '/setup') {
      return redirect(req, res, '/setup');
    }

    if (pathname === '/') {
      return redirect(req, res, '/admin/projects');
    }

    const match = router.match(req.method, pathname);
    if (!match) {
      return html(req, res, 404, errorPage({ status: 404, message: 'Not found.' }));
    }

    Promise.resolve(match.handler(req, res, match.params)).catch((err) => {
      console.error(err);
      if (!res.headersSent) {
        html(req, res, 500, errorPage({ status: 500, message: 'Something went wrong.' }));
      }
    });
  });

  server.coreDb = coreDb;
  server.projectDbs = projectDbs;
  server.appConfig = config;

  server.closeAll = () => {
    projectDbs.closeAll();
    coreDb.close();
  };

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.listen(app.appConfig.port, () => {
    console.log(`yncms listening on http://localhost:${app.appConfig.port}`);
  });
}
