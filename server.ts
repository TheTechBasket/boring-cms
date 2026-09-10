import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
  deleteSetting,
  listSettingKeys,
  getSettingValue,
  addCredential,
  listCredentials,
  credentialCount,
  getCredentialByCredId,
  updateCredentialCounter,
  deleteCredential,
} from './lib/store.ts';
import { verifyRegistration, verifyAssertion, b64url } from './lib/webauthn.ts';
import { readMultipart } from './lib/multipart.ts';
import { exportSchema, exportCollection, exportProject, applySchema, parseImportFile, applyImport } from './lib/transfer.ts';
import { localBackend, s3Backend } from './lib/storage.ts';
import { listMedia, getMedia, createMedia, deleteMedia, findServableMedia, registerMedia, syncMedia, mediaUsage, mediaKeyFor, mediaPrefixFrom, adoptableKey, guessMime, hasSharp } from './lib/media.ts';
import { signValue, verifySignedValue } from './lib/crypto.ts';
import { Router, readBody, readFormBody, parseCookies, setCookie, clearCookie } from './lib/router.ts';
import { handleMcp, rateLimitOk, retryAfterSeconds, rateLimitHeaders, ToolError, DEFAULT_RATE_LIMIT, MCP_BODY_LIMIT } from './lib/mcp.ts';
import { fireWebhook, type WebhookEvent } from './lib/webhooks.ts';
import {
  FIELD_TYPES,
  describeFieldTypes,
  contentVersion,
  bumpContentVersion,
  listCollections,
  getCollection,
  createCollection,
  addCollectionField,
  updateCollectionField,
  removeCollectionField,
  fieldUsage,
  validateEntryData,
  reorderCollectionFields,
  deleteCollection,
  listEntries,
  countEntries,
  entryLabel,
  getEntry,
  createEntry,
  updateEntry,
  renameEntry,
  setCollectionRevisions,
  publishEntry,
  unpublishEntry,
  deleteEntry,
  listRevisions,
  revertToRevision,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  setApiKeyMcp,
  verifyApiKey,
  listPublished,
  getPublished,
  slugify,
  uniqueSlug,
  getMeta,
  setMeta,
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
  accountPage,
  errorPage,
} from './lib/views.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = 'yn_session';

export function createApp(configOverrides = {}) {
  const config = { ...loadConfig(__dirname), ...configOverrides };
  if (!config.masterKey || config.masterKey.length < 32) {
    const suggested = randomBytes(32).toString('base64url');
    throw new Error(
      'SECRET_KEY missing or shorter than 32 characters. Boring CMS refuses to start without it.\n' +
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

  // Origin/rpId per request; behind TRUST_PROXY=1 the forwarded proto
  // decides https, which also flips session cookies to Secure.
  function requestOrigin(req) {
    const proto = config.trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const host = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host || `localhost:${config.port}`;
    return { origin: `${proto}://${host}`, rpId: String(host).split(':')[0], secure: proto === 'https' };
  }

  function loginUser(req, res, userId) {
    const sessionId = createSession(coreDb, userId);
    setCookie(res, SESSION_COOKIE, signValue(config.masterKey, sessionId), {
      maxAgeSeconds: 30 * 24 * 60 * 60,
      secure: requestOrigin(req).secure,
    });
  }

  // Short-lived signed challenge cookie: stateless, survives no DB write.
  const CHALLENGE_COOKIE = 'yn_challenge';

  function issueChallenge(req, res) {
    const challenge = randomBytes(32).toString('base64url');
    setCookie(res, CHALLENGE_COOKIE, signValue(config.masterKey, `${challenge}.${Date.now()}`), {
      maxAgeSeconds: 300,
      secure: requestOrigin(req).secure,
    });
    return challenge;
  }

  function readChallenge(req, res) {
    const signed = parseCookies(req)[CHALLENGE_COOKIE];
    const value = signed ? verifySignedValue(config.masterKey, signed) : null;
    clearCookie(res, CHALLENGE_COOKIE);
    if (!value) return null;
    const [challenge, ts] = value.split('.');
    if (Date.now() - Number(ts) > 5 * 60 * 1000) return null;
    return challenge;
  }

  function googleSettings() {
    const clientId = getSettingValue(coreDb, config.masterKey, { scope: 'global', key: 'google_client_id' });
    const clientSecret = getSettingValue(coreDb, config.masterKey, { scope: 'global', key: 'google_client_secret' });
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  // Password login can be turned off once a passkey or Google works, killing
  // the brute-force surface. Self-healing: if both alternatives are gone the
  // "off" setting is ignored, and FORCE_PASSWORD_RESET always re-enables it,
  // so the admin can never be locked out.
  function passwordLoginEnabled() {
    if (config.forcePasswordReset) return true;
    const off = getSettingValue(coreDb, config.masterKey, { scope: 'global', key: 'password_login' }) === 'off';
    if (!off) return true;
    return !(credentialCount(coreDb) > 0 || googleSettings());
  }

  function loginPageProps(extra = {}) {
    return { passkeys: credentialCount(coreDb) > 0, google: !!googleSettings(), password: passwordLoginEnabled(), ...extra };
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
    html(req, res, 200, loginPage(loginPageProps()));
  });

  router.post('/login', async (req, res) => {
    if (userCount(coreDb) === 0) return redirect(req, res, '/setup');
    if (!passwordLoginEnabled()) {
      return html(req, res, 403, loginPage(loginPageProps({ error: 'Password login is disabled. Use a passkey or Google.' })));
    }
    const form = await readFormBody(req);
    const email = (form.email || '').trim().toLowerCase();
    const password = form.password || '';
    const user = getUserByEmail(coreDb, email);
    const ok = user && (await verifyUserPassword(user, password));
    if (!ok) {
      return html(req, res, 401, loginPage(loginPageProps({ error: 'Incorrect email or password.' })));
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

  // ---- WebAuthn (passkeys) ------------------------------------------------

  router.post('/webauthn/register/options', (req, res) => {
    const user = currentUser(req);
    if (!user) return json(req, res, 401, { error: 'unauthorized' });
    const { rpId } = requestOrigin(req);
    json(req, res, 200, {
      challenge: issueChallenge(req, res),
      rp: { id: rpId, name: 'Boring CMS' },
      user: { id: b64url(Buffer.from(String(user.id))), name: user.email, displayName: user.email },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      excludeCredentials: listCredentials(coreDb, user.id).map((c) => ({ type: 'public-key', id: c.credential_id })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
  });

  router.post('/webauthn/register', async (req, res) => {
    const user = currentUser(req);
    if (!user) return json(req, res, 401, { error: 'unauthorized' });
    const challenge = readChallenge(req, res);
    if (!challenge) return json(req, res, 400, { error: 'Challenge expired, try again.' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
      const { origin, rpId } = requestOrigin(req);
      const cred = verifyRegistration(body, { challenge, origin, rpId });
      addCredential(coreDb, {
        userId: user.id,
        name: (body.name || '').trim() || 'Passkey',
        credentialId: cred.credentialId,
        publicKeyJwk: cred.publicKeyJwk,
        counter: cred.counter,
        transports: body.transports || [],
      });
    } catch (err) {
      return json(req, res, 400, { error: err.message });
    }
    json(req, res, 200, { ok: true });
  });

  router.post('/webauthn/login/options', (req, res) => {
    if (credentialCount(coreDb) === 0) return json(req, res, 400, { error: 'No passkeys registered.' });
    const { rpId } = requestOrigin(req);
    json(req, res, 200, {
      challenge: issueChallenge(req, res),
      rpId,
      allowCredentials: coreDb.prepare('SELECT credential_id FROM credentials').all()
        .map((c) => ({ type: 'public-key', id: c.credential_id })),
      userVerification: 'preferred',
    });
  });

  router.post('/webauthn/login', async (req, res) => {
    const challenge = readChallenge(req, res);
    if (!challenge) return json(req, res, 400, { error: 'Challenge expired, try again.' });
    try {
      const body = JSON.parse(await readBody(req));
      const cred = getCredentialByCredId(coreDb, body.id);
      if (!cred) return json(req, res, 400, { error: 'Unknown passkey.' });
      const { origin, rpId } = requestOrigin(req);
      const { counter } = verifyAssertion(body, {
        publicKeyJwk: JSON.parse(cred.public_key),
        challenge,
        origin,
        rpId,
        counter: cred.counter,
      });
      updateCredentialCounter(coreDb, cred.id, counter);
      loginUser(req, res, cred.user_id);
    } catch (err) {
      return json(req, res, 400, { error: err.message });
    }
    json(req, res, 200, { ok: true });
  });

  // ---- Google OAuth (code flow with PKCE, plain fetch) --------------------

  const OAUTH_COOKIE = 'yn_oauth';

  router.get('/auth/google', (req, res) => {
    const g = googleSettings();
    if (!g) return redirect(req, res, '/login');
    const { origin, secure } = requestOrigin(req);
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(16).toString('base64url');
    setCookie(res, OAUTH_COOKIE, signValue(config.masterKey, `${verifier}.${state}`), { maxAgeSeconds: 600, secure });
    const params = new URLSearchParams({
      client_id: g.clientId,
      redirect_uri: `${origin}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    redirect(req, res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  router.get('/auth/google/callback', async (req, res) => {
    const g = googleSettings();
    const url = new URL(req.url, 'http://localhost');
    const stored = parseCookies(req)[OAUTH_COOKIE];
    clearCookie(res, OAUTH_COOKIE);
    const value = stored ? verifySignedValue(config.masterKey, stored) : null;
    const [verifier, state] = (value || '').split('.');
    const fail = (message) => html(req, res, 401, loginPage(loginPageProps({ error: message })));
    if (!g || !verifier || url.searchParams.get('state') !== state) return fail('Google sign-in failed, try again.');
    const code = url.searchParams.get('code');
    if (!code) return fail('Google sign-in was cancelled.');
    try {
      const { origin } = requestOrigin(req);
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: g.clientId,
          client_secret: g.clientSecret,
          redirect_uri: `${origin}/auth/google/callback`,
          grant_type: 'authorization_code',
          code_verifier: verifier,
        }),
      });
      const token: any = await tokenRes.json();
      if (!token.access_token) return fail('Google token exchange failed.');
      const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const info: any = await infoRes.json();
      const email = (info.email || '').toLowerCase();
      const user = email ? getUserByEmail(coreDb, email) : null;
      if (!user) return fail(`${email || 'That Google account'} is not the admin account.`);
      loginUser(req, res, user.id);
      redirect(req, res, '/admin/projects');
    } catch {
      fail('Google sign-in failed, try again.');
    }
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

  // ---- Account (password + passkeys) --------------------------------------

  function accountProps(user, extra = {}) {
    return {
      user,
      projects: listProjects(coreDb),
      credentials: listCredentials(coreDb, user.id),
      google: !!googleSettings(),
      passwordLogin: passwordLoginEnabled(),
      ...extra,
    };
  }

  router.get('/account', requireAdmin((req, res, params, user) => {
    html(req, res, 200, accountPage(accountProps(user)));
  }));

  // Turn password login off (only while a passkey or Google works) or back on.
  router.post('/account/login-methods', requireAdmin(async (req, res, params, user) => {
    const form = await readFormBody(req);
    const off = form.password_login === 'off';
    if (off && !(credentialCount(coreDb) > 0 || googleSettings())) {
      return html(req, res, 400, accountPage(accountProps(user, { notice: { type: 'error', message: 'Add a passkey or configure Google first, or you would be locked out.' } })));
    }
    setSetting(coreDb, config.masterKey, { scope: 'global', key: 'password_login', value: off ? 'off' : 'on' });
    html(req, res, 200, accountPage(accountProps(user, { notice: { type: 'success', message: off ? 'Password login disabled. The login page now only offers passkeys and Google.' : 'Password login re-enabled.' } })));
  }));

  router.post('/account/password', requireAdmin(async (req, res, params, user) => {
    const form = await readFormBody(req);
    const render = (notice) => html(req, res, notice.type === 'error' ? 400 : 200, accountPage(accountProps(user, { notice })));
    if (!(await verifyUserPassword(user, form.current_password || ''))) {
      return render({ type: 'error', message: 'Current password is incorrect.' });
    }
    const password = form.password || '';
    if (password.length < 8) return render({ type: 'error', message: 'New password must be at least 8 characters.' });
    if (password !== form.password_confirm) return render({ type: 'error', message: 'Passwords do not match.' });
    await setUserPassword(coreDb, user.id, password);
    render({ type: 'success', message: 'Password changed.' });
  }));

  router.post('/account/passkeys/:credId/delete', requireAdmin((req, res, params, user) => {
    deleteCredential(coreDb, user.id, Number.parseInt(params.credId, 10));
    redirect(req, res, '/account');
  }));

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

  function renderProjectDetail(req: any, res: any, project: any, user: any, extra: any = {}, status = 200) {
    const settingKeys = listSettingKeys(coreDb, { scope: 'project', projectId: project.id })
      .filter((s: any) => !['webhook_url', 'webhook_secret'].includes(s.key));
    const globalSettingKeys = plainSettingKeys();
    const mediaStorage = getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key: 'media_storage' }) || '';
    const currentWebhookUrl = getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key: 'webhook_url' }) || '';
    const currentWebhookSecret = getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key: 'webhook_secret' }) || '';
    const editKey = new URL(req.url, 'http://localhost').searchParams.get('edit') || '';
    return html(
      req,
      res,
      status,
      projectDetailPage({
        user,
        projects: listProjects(coreDb),
        project,
        settingKeys,
        globalSettingKeys,
        editKey,
        storages: listStorages(),
        mediaStorage,
        webhookUrl: currentWebhookUrl,
        hasWebhookSecret: !!currentWebhookSecret,
        ...extra,
      }),
    );
  }

  function saveProjectWebhook(req: any, res: any, project: any, form: any, user: any) {
    const webhookUrl = (form.webhook_url ?? '').trim();
    const webhookSecret = (form.webhook_secret ?? '').trim();

    if (webhookUrl) {
      try {
        const u = new URL(webhookUrl);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          throw new Error('invalid protocol');
        }
      } catch {
        return renderProjectDetail(
          req,
          res,
          project,
          user,
          {
            webhookUrl,
            notice: { type: 'error', message: 'Webhook URL must be a valid http or https URL.' },
          },
          400,
        );
      }
      setSetting(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key: 'webhook_url', value: webhookUrl });
    } else {
      deleteSetting(coreDb, { scope: 'project', projectId: project.id, key: 'webhook_url' });
    }

    if (webhookSecret) {
      setSetting(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key: 'webhook_secret', value: webhookSecret });
    }

    redirect(req, res, `/admin/projects/${project.slug}`);
  }

  function triggerWebhook(project: any, collectionSlug: string, entrySlug: string, event: WebhookEvent) {
    try {
      const url = getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key: 'webhook_url' });
      if (!url) return;
      const secret = getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key: 'webhook_secret' });
      fireWebhook(url, secret, {
        event,
        project: project.slug,
        collection: collectionSlug,
        slug: entrySlug,
        at: new Date().toISOString(),
      });
    } catch {
      // Never block or fail the request on webhook problems
    }
  }

  router.get(
    '/admin/projects/:slug',
    requireAdmin((req, res, params, user) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      renderProjectDetail(req, res, project, user);
    }),
  );

  // Pick which shared storage this project uploads to. 'local' (or blank)
  // means the project's own disk folder / legacy s3_* settings.
  router.post(
    '/admin/projects/:slug/storage',
    requireAdmin(async (req, res, params) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const form = await readFormBody(req);
      const choice = (form.storage || 'local').trim();
      // Pin unpinned rows to the base they live under right now, so their
      // URLs keep working after the switch. "Migrate media" moves them later.
      const oldBase = mediaConfigFor(project).publicBase || '';
      const db = projectDbs.get(project.slug);
      db.prepare('UPDATE media SET base_url = ? WHERE base_url IS NULL').run(oldBase);
      setSetting(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key: 'media_storage', value: choice });
      // Rows already on the new storage's base unpin again (no-op switches,
      // or switching back).
      const newBase = mediaConfigFor(project).publicBase || '';
      db.prepare('UPDATE media SET base_url = NULL WHERE base_url = ?').run(newBase);
      redirect(req, res, `/admin/projects/${project.slug}`);
    }),
  );

  router.post(
    '/admin/projects/:slug/rename',
    requireAdmin(async (req, res, params) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const form = await readFormBody(req);
      const name = (form.name || '').trim();
      if (name) renameProject(coreDb, project.slug, name, form.icon !== undefined ? form.icon.trim() : null);
      redirect(req, res, `/admin/projects/${project.slug}`);
    }),
  );

  router.post(
    '/admin/projects/:slug/webhook',
    requireAdmin(async (req, res, params, user) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const form = await readFormBody(req);
      saveProjectWebhook(req, res, project, form, user);
    }),
  );

  router.post(
    '/admin/projects/:slug/settings',
    requireAdmin(async (req, res, params, user) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const form = await readFormBody(req);
      if (form.webhook_url !== undefined || form.webhook_secret !== undefined) {
        return saveProjectWebhook(req, res, project, form, user);
      }
      const key = (form.key || '').trim();
      const value = form.value || '';
      if (key && value) {
        setSetting(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key, value });
      }
      redirect(req, res, `/admin/projects/${project.slug}`);
    }),
  );

  router.post(
    '/admin/projects/:slug/settings/delete',
    requireAdmin(async (req, res, params) => {
      const project = getProjectBySlug(coreDb, params.slug);
      if (!project) return html(req, res, 404, errorPage({ status: 404, message: 'Project not found.' }));
      const form = await readFormBody(req);
      const key = (form.key || '').trim();
      if (key) deleteSetting(coreDb, { scope: 'project', projectId: project.id, key });
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
        return renderProjectDetail(
          req,
          res,
          project,
          user,
          { notice: { type: 'error', message: 'Type the project slug exactly to confirm deletion.' } },
          400,
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
      const url = new URL(req.url, 'http://localhost');
      const editKey = url.searchParams.get('edit') || '';
      const storageEditName = url.searchParams.get('storage') || '';
      const storageEdit = storageEditName ? storageDetail(storageEditName) : null;
      html(req, res, 200, globalSettingsPage({ user, projects: listProjects(coreDb), settingKeys: plainSettingKeys(), editKey, storages: listStorageDetails(), storageEdit }));
    }),
  );

  // Storage blobs live in the settings table but get their own UI; keep
  // them out of the generic write-only secrets list.
  function plainSettingKeys() {
    return listSettingKeys(coreDb, { scope: 'global' }).filter((s) => !s.key.startsWith('storage_'));
  }

  // Everything except the secret, for display and edit pre-fill.
  function storageDetail(name) {
    const blob = getStorage(name);
    if (!blob) return null;
    const { secret, ...rest } = blob;
    return { name, ...rest };
  }

  function listStorageDetails() {
    return listStorages().map(storageDetail).filter(Boolean);
  }

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

  router.post(
    '/admin/settings/delete',
    requireAdmin(async (req, res, params) => {
      const form = await readFormBody(req);
      const key = (form.key || '').trim();
      if (key) deleteSetting(coreDb, { scope: 'global', key });
      redirect(req, res, '/admin/settings');
    }),
  );

  // Add or update a shared storage. Stored as one encrypted global setting
  // storage_<name>; the edit form pre-fills everything except the secret,
  // and a blank secret on update keeps the existing one (re-roll by pasting
  // a new value only).
  router.post(
    '/admin/settings/storage',
    requireAdmin(async (req, res, params, user) => {
      const form = await readFormBody(req);
      const name = slugify((form.name || '').trim());
      const render = (notice) =>
        html(req, res, notice.type === 'error' ? 400 : 200, globalSettingsPage({ user, projects: listProjects(coreDb), settingKeys: plainSettingKeys(), storages: listStorageDetails(), notice }));
      const existing = name ? getStorage(name) : null;
      const secret = form.secret || existing?.secret || '';
      if (!name || !form.endpoint || !form.bucket || !form.key || !secret) {
        return render({ type: 'error', message: 'Name, endpoint, bucket, access key and secret are required.' });
      }
      const blob = {
        endpoint: form.endpoint.trim(),
        bucket: form.bucket.trim(),
        key: form.key.trim(),
        secret,
        region: (form.region || '').trim() || 'auto',
        public_url: (form.public_url || '').trim(),
      };
      // Test before saving: a probe PUT + LIST + DELETE proves the
      // credentials, bucket and endpoint actually work with the exact
      // permissions the CMS needs.
      if (form.skip_test !== '1') {
        const err = await probeStorage(blob);
        if (err) return render({ type: 'error', message: `Storage test failed, nothing saved: ${err}` });
      }
      setSetting(coreDb, config.masterKey, { scope: 'global', key: `storage_${name}`, value: JSON.stringify(blob) });
      render({ type: 'success', message: `Storage "${name}" ${form.skip_test === '1' ? 'saved without testing' : 'tested and saved'}. Select it on any project page.` });
    }),
  );

  router.post(
    '/admin/settings/storage/delete',
    requireAdmin(async (req, res) => {
      const form = await readFormBody(req);
      const name = slugify((form.name || '').trim());
      if (name) deleteSetting(coreDb, { scope: 'global', key: `storage_${name}` });
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
      else if (f.type === 'relation') {
        const slugs = Array.isArray(raw) ? raw : raw ? [raw] : [];
        data[f.name] = f.multiple ? slugs : (slugs[0] ?? '');
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

  // Storage registry: global settings named storage_<name> hold a JSON blob
  // (endpoint, bucket, key, secret, region, public_url). Configure once,
  // any project can select one via its media_storage setting.
  function listStorages() {
    return listSettingKeys(coreDb, { scope: 'global' })
      .map((s) => s.key)
      .filter((k) => k.startsWith('storage_'))
      .map((k) => k.slice('storage_'.length));
  }

  // Write, list and delete a probe object: the three permissions the CMS
  // needs. Returns an error string, or null when the storage works.
  async function probeStorage(blob) {
    const backend = s3Backend({
      endpoint: blob.endpoint,
      bucket: blob.bucket,
      region: blob.region || 'auto',
      accessKey: blob.key,
      secretKey: blob.secret,
    });
    const probeKey = `boring-cms-probe-${randomBytes(4).toString('hex')}.txt`;
    try {
      await backend.put(probeKey, Buffer.from('Boring CMS storage probe'), 'text/plain');
      await backend.list();
      await backend.remove(probeKey);
      return null;
    } catch (err) {
      return String(err.message || err).slice(0, 300);
    }
  }

  function getStorage(name) {
    const raw = getSettingValue(coreDb, config.masterKey, { scope: 'global', key: `storage_${name}` });
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function sharedStorageConfig(shared) {
    const publicUrl = (shared.public_url || '').replace(/\/+$/, '') || null;
    return {
      backend: s3Backend({
        endpoint: shared.endpoint,
        bucket: shared.bucket,
        region: shared.region || 'auto',
        accessKey: shared.key,
        secretKey: shared.secret,
        publicUrl,
      }),
      publicBase: publicUrl,
      isS3: true,
    };
  }

  function localStorageConfig(project) {
    return { backend: localBackend(path.join(config.dataDir, 'media', project.slug)), publicBase: null, isS3: false };
  }

  // The project's default upload storage: a shared global storage if
  // selected, else the legacy per-project s3_* settings, else local disk.
  function mediaConfigFor(project) {
    const setting = (key) =>
      getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key });
    const storageName = setting('media_storage');
    const shared = storageName && storageName !== 'local' ? getStorage(storageName) : null;
    if (shared) return sharedStorageConfig(shared);
    if (setting('media_backend') === 's3') {
      return sharedStorageConfig({
        endpoint: setting('s3_endpoint'),
        bucket: setting('s3_bucket'),
        region: setting('s3_region'),
        key: setting('s3_key'),
        secret: setting('s3_secret'),
        public_url: setting('s3_public_url'),
      });
    }
    return localStorageConfig(project);
  }

  function mediaBackendFor(project) {
    return mediaConfigFor(project).backend;
  }

  // Name of the project's default storage as shown in storage pickers.
  function defaultStorageName(project) {
    const setting = (key) =>
      getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: project.id, key });
    const name = setting('media_storage');
    if (name && name !== 'local' && getStorage(name)) return name;
    if (!name && setting('media_backend') === 's3') return 'legacy-s3';
    return 'local';
  }

  // Resolve an explicit storage choice from a form. '' or the default name
  // means "use the project default". Any storage stays usable at any time;
  // the project setting only picks the default.
  function storageChoiceConfig(project, choice) {
    const def = defaultStorageName(project);
    if (!choice || choice === def) return { name: def, isDefault: true, ...mediaConfigFor(project) };
    if (choice === 'local') return { name: 'local', isDefault: false, ...localStorageConfig(project) };
    const shared = getStorage(choice);
    if (!shared) return { name: def, isDefault: true, ...mediaConfigFor(project) };
    return { name: choice, isDefault: false, ...sharedStorageConfig(shared) };
  }

  // Rows uploaded to a non-default storage get pinned to where they live, so
  // switching the default never breaks their URLs.
  function pinBaseFor(chosen) {
    return chosen.isDefault ? null : chosen.publicBase || '';
  }

  // Old base -> a backend with object rights there: local disk, or the
  // shared storage whose public URL matches.
  function backendForBase(project, base) {
    if (base === '') return localBackend(path.join(config.dataDir, 'media', project.slug));
    for (const name of listStorages()) {
      const s = getStorage(name);
      if (s && (s.public_url || '').replace(/\/+$/, '') === base) {
        return s3Backend({ endpoint: s.endpoint, bucket: s.bucket, region: s.region || 'auto', accessKey: s.key, secretKey: s.secret });
      }
    }
    return null;
  }

  // Storage options offered in upload/sync/filter selects: the default, local
  // disk, and every shared storage with a public URL (without one, a
  // non-default storage could not serve its files).
  function storageOptions(project) {
    const def = defaultStorageName(project);
    const options = [{ name: def, label: `${def} (default)` }];
    if (def !== 'local') options.push({ name: 'local', label: 'local' });
    for (const name of listStorages()) {
      if (name === def) continue;
      const s = getStorage(name);
      if (s && (s.public_url || '').trim()) options.push({ name, label: name });
    }
    return options;
  }

  // Effective URL per row: pinned rows (base_url set on a storage switch)
  // keep serving from where the file actually lives; unpinned rows follow
  // the project's current storage. stale = pinned somewhere else.
  function mediaUrlFor(m, project, publicBase) {
    const base = m.base_url === null || m.base_url === undefined ? publicBase || '' : m.base_url;
    return (key) => (base ? `${base}/${key}` : `/media/${project.slug}/${key}`);
  }

  function decorateMedia(m, project, publicBase) {
    const urlFor = mediaUrlFor(m, project, publicBase);
    const stale = m.base_url !== null && m.base_url !== undefined && m.base_url !== (publicBase || '');
    return { ...m, url: urlFor(m.key), stale };
  }

  // Key-authenticated upload shared by the REST media route and the MCP
  // upload_media tool. Throws ToolError with a client-safe message on bad
  // input; returns {id, key, url} with the full public URL.
  async function apiUploadMedia(project, db, { filename, mime = '', data, path: rawPath = '', storage = '', variants = false }) {
    const prefix = mediaPrefixFrom(String(rawPath).replace(/^\/+|\/+$/g, ''));
    if (prefix === null) throw new ToolError('Invalid path: use "/"-separated segments of letters, digits, ".", "_", "-" (no dot-only segments).');
    const chosen = storageChoiceConfig(project, String(storage).trim());
    if (prefix && !chosen.publicBase) throw new ToolError('Folder paths need a storage with a public base URL; the chosen storage has none.');
    const media = await createMedia(db, chosen.backend, { filename, mime: mime || guessMime(filename), data }, { withVariants: !!variants, prefix });
    const pin = pinBaseFor(chosen);
    if (pin !== null) db.prepare('UPDATE media SET base_url = ? WHERE id = ? AND base_url IS NULL').run(pin, media.id);
    const base = pin === null ? chosen.publicBase : pin || null;
    return { id: media.id, key: media.key, url: base ? `${base}/${media.key}` : `/media/${project.slug}/${media.key}` };
  }

  // Storage label per row for the gallery filter: where the file lives.
  function storageLabelFor(m, defaultName, baseNames) {
    if (m.base_url === null || m.base_url === undefined) return defaultName;
    if (m.base_url === '') return 'local';
    return baseNames[m.base_url] || 'other';
  }

  function mediaCtx(ctx, db, pathPrefix = '') {
    const setting = (key) => getSettingValue(coreDb, config.masterKey, { scope: 'project', projectId: ctx.project.id, key });
    const { publicBase, isS3 } = mediaConfigFor(ctx.project);
    const defaultName = defaultStorageName(ctx.project);
    const baseNames = {};
    for (const name of listStorages()) {
      const s = getStorage(name);
      const base = (s?.public_url || '').replace(/\/+$/, '');
      if (base) baseNames[base] = name;
    }
    const all = listMedia(db).map((m) => ({
      ...decorateMedia(m, ctx.project, publicBase),
      storage: storageLabelFor(m, defaultName, baseNames),
    }));
    // Path drill-down: nested keys (adopted from S3) browse like folders.
    const prefix = pathPrefix ? `${pathPrefix}/` : '';
    const media = [];
    const subfolders = new Map();
    for (const m of all) {
      if (pathPrefix && !m.key.startsWith(prefix)) continue;
      const rest = m.key.slice(prefix.length);
      if (!pathPrefix && !m.key.includes('/')) media.push(m);
      else if (pathPrefix && !rest.includes('/')) media.push(m);
      else {
        const seg = (pathPrefix ? rest : m.key).split('/')[0];
        subfolders.set(seg, (subfolders.get(seg) || 0) + 1);
      }
    }
    // Per-image "where used": a plain scan, no stored relationships.
    const usage = Object.fromEntries(media.map((m) => [m.key, mediaUsage(db, m.key)]));
    return {
      ...ctx,
      media,
      usage,
      pathPrefix,
      subfolders: [...subfolders.entries()].sort().map(([name, count]) => ({ name, count })),
      staleCount: all.filter((m) => m.stale).length,
      oldCopyCount: all.filter((m) => m.migrated_from !== null && m.migrated_from !== undefined).length,
      storages: storageOptions(ctx.project),
      storageLabels: [...new Set(all.map((m) => m.storage))].sort(),
      defaultStorage: defaultName,
      publicBase,
      variantsMode: setting('media_variants') || '',
      hasSharp,
      directUpload: isS3,
    };
  }

  // Media + relation-field option lists for the entry editor.
  // relationOptions is { fieldName: [{slug, label}] }, capped at 500 per
  // target collection (ponytail: fine at current scale, add a searchable
  // picker if a target collection outgrows a plain <select>).
  function editorMedia(ctx, db) {
    const { publicBase } = mediaConfigFor(ctx.project);
    const relationOptions: Record<string, Array<{ slug: string; label: string }>> = {};
    for (const f of ctx.collection.fields) {
      if (f.type !== 'relation' || !f.collection) continue;
      const target = getCollection(db, f.collection);
      relationOptions[f.name] = target
        ? listEntries(db, target.id, { limit: 500 }).map((e) => ({ slug: e.slug, label: entryLabel(e, target) }))
        : [];
    }
    return { media: listMedia(db).map((m) => decorateMedia(m, ctx.project, publicBase)), publicBase, relationOptions };
  }

  router.get('/admin/projects/:slug/media', withProject((req, res, params, ctx, db) => {
    const raw = new URL(req.url, 'http://localhost').searchParams.get('path') || '';
    const pathPrefix = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(raw) ? raw : '';
    html(req, res, 200, mediaPage(mediaCtx(ctx, db, pathPrefix)));
  }));

  router.post('/admin/projects/:slug/media', withProject(async (req, res, params, ctx, db) => {
    let upload;
    try {
      upload = await readMultipart(req);
    } catch (err) {
      return html(req, res, 400, mediaPage({ ...mediaCtx(ctx, db), notice: { type: 'error', message: err.message } }));
    }
    const file = upload.files.file;
    const wantsJson = upload.fields.json === '1';
    if (!file) {
      if (wantsJson) return json(req, res, 400, { error: 'Choose a file to upload.' });
      return html(req, res, 400, mediaPage({ ...mediaCtx(ctx, db), notice: { type: 'error', message: 'Choose a file to upload.' } }));
    }
    const chosen = storageChoiceConfig(ctx.project, (upload.fields.storage || '').trim());
    const media = await createMedia(db, chosen.backend, file, {
      withVariants: upload.fields.variants === '1',
    });
    const pin = pinBaseFor(chosen);
    if (pin !== null) db.prepare('UPDATE media SET base_url = ? WHERE id = ? AND base_url IS NULL').run(pin, media.id);
    // json=1: the entry editor uploads from the image picker via fetch and
    // needs the public URL back instead of a redirect.
    if (wantsJson) {
      const base = pin === null ? chosen.publicBase : pin || null;
      return json(req, res, 200, { id: media.id, key: media.key, url: base ? `${base}/${media.key}` : `/media/${ctx.project.slug}/${media.key}` });
    }
    redirect(req, res, `/admin/projects/${ctx.project.slug}/media`);
  }));

  // Presigned browser-to-bucket upload: sign, let the browser PUT, then
  // register the row. Bytes never pass through the server.
  router.post('/admin/projects/:slug/media/presign', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const chosen = storageChoiceConfig(ctx.project, (form.storage || '').trim());
    if (!/^[0-9a-f]{64}$/.test(form.hash || '') || !form.filename) {
      return json(req, res, 400, { error: 'hash (sha256 hex) and filename required' });
    }
    const prefix = mediaPrefixFrom(String(form.path || '').replace(/^\/+|\/+$/g, ''));
    if (prefix === null) return json(req, res, 400, { error: 'invalid path' });
    if (prefix && !chosen.publicBase) return json(req, res, 400, { error: 'Folder paths need a storage with a public base URL.' });
    const { key } = mediaKeyFor(form.hash, form.filename, prefix);
    const url = chosen.backend.presignPut(key, form.mime || 'application/octet-stream');
    if (!url) return json(req, res, 400, { error: 'Direct upload needs the S3 backend.' });
    json(req, res, 200, { url, key });
  }));

  router.post('/admin/projects/:slug/media/register', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const chosenReg = storageChoiceConfig(ctx.project, (form.storage || '').trim());
    if (!adoptableKey(form.key || '', !!chosenReg.publicBase) || !form.filename) {
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
    const pin = pinBaseFor(chosenReg);
    if (pin !== null) db.prepare('UPDATE media SET base_url = ? WHERE id = ? AND base_url IS NULL').run(pin, media.id);
    json(req, res, 200, { id: media.id, key: media.key });
  }));

  // Check-first sync: the default run only reports what would happen
  // (adoptable files with preview links, rows whose object is gone); apply=1
  // actually adopts. A storage select syncs any configured storage, with
  // adopted rows pinned to where they live.
  router.post('/admin/projects/:slug/media/sync', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const choice = (form.storage || '').trim();
    const chosen = storageChoiceConfig(ctx.project, choice);
    const apply = form.apply === '1';
    let report;
    try {
      report = await syncMedia(db, chosen.backend, { apply, allowNested: !!chosen.publicBase });
    } catch (err) {
      return html(req, res, 400, mediaPage({ ...mediaCtx(ctx, db), notice: { type: 'error', message: err.message } }));
    }
    const pin = pinBaseFor(chosen);
    if (apply && pin !== null) {
      for (const key of report.adopted) {
        db.prepare('UPDATE media SET base_url = ? WHERE key = ? AND base_url IS NULL').run(pin, key);
      }
    }
    const summary = apply
      ? `${report.adopted.length} adopted, ${report.missing.length} missing of ${report.total} objects.`
      : `${report.adoptable.length} adoptable, ${report.missing.length} missing of ${report.total} objects. Nothing changed yet.`;
    html(req, res, 200, mediaPage({
      ...mediaCtx(ctx, db),
      syncReport: { ...report, apply, storage: chosen.name, publicBase: chosen.publicBase },
      notice: { type: 'success', message: apply ? `Storage synced: ${summary}` : `Sync check (${chosen.name}): ${summary}` },
    }));
  }));

  router.post('/admin/projects/:slug/media/:id/delete', withProject(async (req, res, params, ctx, db) => {
    const m = getMedia(db, Number(params.id));
    // Pinned rows live on another storage; delete the object there, not on
    // the current default. Unknown base: remove the row, leave the object.
    const backend = m && m.base_url !== null && m.base_url !== undefined
      ? backendForBase(ctx.project, m.base_url)
      : mediaBackendFor(ctx.project);
    if (backend) await deleteMedia(db, backend, Number(params.id));
    else if (m) db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
    redirect(req, res, `/admin/projects/${ctx.project.slug}/media`);
  }));

  // Copy pinned rows to the current storage, then rewrite every entry URL
  // to the new base. Never overwrites an existing object in the destination
  // and never deletes from the source, so the old bucket stays intact until
  // the admin removes it themselves.
  router.post('/admin/projects/:slug/media/migrate', withProject(async (req, res, params, ctx, db) => {
    const { backend, publicBase } = mediaConfigFor(ctx.project);
    const stale = listMedia(db)
      .map((m) => decorateMedia(m, ctx.project, publicBase))
      .filter((m) => m.stale);
    const localDir = path.join(config.dataDir, 'media', ctx.project.slug);
    const lines = [];
    let moved = 0;
    let failed = 0;
    let rewrote = 0;

    async function readSource(m, key) {
      if (m.base_url === '') {
        const p = path.join(localDir, key);
        return existsSync(p) ? readFileSync(p) : null;
      }
      const res = await fetch(`${m.base_url}/${key}`);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }

    for (const m of stale) {
      const keys = [m.key, ...Object.values(m.variants)];
      try {
        for (const key of keys) {
          // No overwrite: if the destination already has the object, keep it.
          if (await backend.stream(key)) continue;
          const buf = await readSource(m, key);
          if (!buf) throw new Error(`source object missing: ${key}`);
          await backend.put(key, buf, m.mime);
        }
        const oldFor = mediaUrlFor(m, ctx.project, publicBase);
        const newFor = mediaUrlFor({ base_url: null }, ctx.project, publicBase);
        for (const key of keys) {
          const oldUrl = oldFor(key);
          const newUrl = newFor(key);
          if (oldUrl === newUrl) continue;
          const changed = db.prepare(
            "UPDATE entries SET data = replace(data, ?, ?), published_data = CASE WHEN published_data IS NULL THEN NULL ELSE replace(published_data, ?, ?) END WHERE data LIKE ? OR published_data LIKE ?",
          ).run(oldUrl, newUrl, oldUrl, newUrl, `%${oldUrl}%`, `%${oldUrl}%`);
          rewrote += changed.changes;
        }
        db.prepare('UPDATE media SET base_url = NULL, migrated_from = ? WHERE id = ?').run(m.base_url, m.id);
        moved += 1;
        lines.push(`moved ${m.key}`);
      } catch (err) {
        failed += 1;
        lines.push(`FAILED ${m.key}: ${String(err.message || err).slice(0, 200)}`);
      }
    }
    if (rewrote > 0) bumpContentVersion(db);
    const summary = `${moved} moved, ${failed} failed, ${rewrote} entry rewrites. Old copies were kept; delete them from the media page when ready.`;
    html(req, res, 200, mediaPage({
      ...mediaCtx(ctx, db),
      report: lines.join('\n'),
      notice: { type: failed ? 'error' : 'success', message: `Migration finished: ${summary}` },
    }));
  }));

  // Delete the old copies left behind by a migration, on demand. Checks
  // each object still exists first and reports what it found. Rows whose
  // old storage credentials are gone are skipped, retryable later.
  router.post('/admin/projects/:slug/media/cleanup', withProject(async (req, res, params, ctx, db) => {
    const rows = listMedia(db).filter((m) => m.migrated_from !== null && m.migrated_from !== undefined);
    const localDir = path.join(config.dataDir, 'media', ctx.project.slug);
    const lines = [];
    let deleted = 0;
    let gone = 0;
    let skipped = 0;

    async function existsAt(base, key) {
      if (base === '') return existsSync(path.join(localDir, key));
      try {
        return (await fetch(`${base}/${key}`, { method: 'HEAD' })).ok;
      } catch {
        return false;
      }
    }

    const currentBase = mediaConfigFor(ctx.project).publicBase || '';
    for (const m of rows) {
      // Never delete the copy the row currently serves from (e.g. after
      // switching back to the old storage).
      const servingBase = m.base_url === null || m.base_url === undefined ? currentBase : m.base_url;
      if (servingBase === m.migrated_from) {
        skipped += 1;
        lines.push(`SKIPPED ${m.key}: the old copy is the one currently in use`);
        continue;
      }
      const backend = backendForBase(ctx.project, m.migrated_from);
      if (!backend) {
        skipped += 1;
        lines.push(`SKIPPED ${m.key}: no storage configured for ${m.migrated_from}, cannot delete there`);
        continue;
      }
      const keys = [m.key, ...Object.values(m.variants)];
      try {
        for (const key of keys) {
          if (await existsAt(m.migrated_from, key)) {
            await backend.remove(key);
            deleted += 1;
            lines.push(`deleted ${key} from ${m.migrated_from || 'local disk'}`);
          } else {
            gone += 1;
            lines.push(`already gone: ${key}`);
          }
        }
        db.prepare('UPDATE media SET migrated_from = NULL WHERE id = ?').run(m.id);
      } catch (err) {
        skipped += 1;
        lines.push(`FAILED ${m.key}: ${String(err.message || err).slice(0, 200)}`);
      }
    }
    const summary = `${deleted} deleted, ${gone} already gone, ${skipped} skipped.`;
    html(req, res, 200, mediaPage({
      ...mediaCtx(ctx, db),
      report: lines.join('\n'),
      notice: { type: skipped ? 'error' : 'success', message: `Old copy cleanup: ${summary}` },
    }));
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
    // Pinned rows serve from where the file actually lives, not from the
    // project's current storage (which may not have the object yet).
    if (found.media.base_url) return redirect(req, res, `${found.media.base_url}/${params.key}`);
    const backend = found.media.base_url === ''
      ? localBackend(path.join(config.dataDir, 'media', project.slug))
      : mediaBackendFor(project);
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
    const url = new URL(req.url, 'http://localhost');
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const q = (url.searchParams.get('q') || '').trim();
    const status = url.searchParams.get('status') || '';
    const limit = 50;
    const filter = { q, status };
    const total = countEntries(db, ctx.collection.id, filter);
    const entries = listEntries(db, ctx.collection.id, { limit, offset: (page - 1) * limit, ...filter });
    const usage = Object.fromEntries(ctx.collection.fields.map((f) => [f.name, fieldUsage(db, ctx.collection.id, f.name)]));
    html(req, res, 200, collectionPage({ ...ctx, entries, page, totalPages: Math.max(1, Math.ceil(total / limit)), q, status, fieldTypes: FIELD_TYPES, collections: listCollections(db), fieldUsage: usage }));
  }));

  router.post('/admin/projects/:slug/collections/:cslug/fields/add', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const label = (form.label || '').trim();
    const type = FIELD_TYPES.includes(form.type) ? form.type : 'text';
    if (label) addCollectionField(db, ctx.collection.slug, { label, type, name: form.name || '', required: form.required === '1', unique: form.unique === '1' });
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}`);
  }));

  router.post('/admin/projects/:slug/collections/:cslug/fields/update', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    if (form.field) {
      // Checkboxes send nothing when unchecked, so these map explicitly.
      updateCollectionField(db, ctx.collection.slug, form.field, { ...form, required: form.required === '1', unique: form.unique === '1', multiple: form.multiple === '1' });
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

  router.post('/admin/projects/:slug/collections/:cslug/revisions', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const keep = form.revisions_keep === '' ? null : Math.max(0, Number.parseInt(form.revisions_keep, 10) || 0);
    setCollectionRevisions(db, ctx.collection.slug, keep);
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
    html(req, res, 200, entryEditorPage({ ...ctx, entry: null, ...editorMedia(ctx, db) }));
  }));

  router.post('/admin/projects/:slug/collections/:cslug/new', withCollection(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const data = collectFieldValues(ctx.collection, form);
    const errors = validateEntryData(ctx.collection, data, { db });
    if (errors.length) {
      return html(req, res, 400, entryEditorPage({ ...ctx, entry: null, draft: data, ...editorMedia(ctx, db), notice: { type: 'error', message: errors.join(' ') } }));
    }
    const entry = createEntry(db, ctx.collection, { data, slug: (form.entry_slug || '').trim() || undefined });
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
    html(req, res, 200, entryEditorPage({ ...ctx, revisions: listRevisions(db, ctx.entry.id), ...editorMedia(ctx, db) }));
  }));

  router.post('/admin/projects/:slug/collections/:cslug/:eslug', withEntry(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const data = collectFieldValues(ctx.collection, form);
    const errors = validateEntryData(ctx.collection, data, { db, excludeEntryId: ctx.entry.id });
    if (errors.length) {
      return html(req, res, 400, entryEditorPage({ ...ctx, entry: { ...ctx.entry, data }, revisions: listRevisions(db, ctx.entry.id), ...editorMedia(ctx, db), notice: { type: 'error', message: errors.join(' ') } }));
    }
    updateEntry(db, ctx.entry, { data });
    let slug = ctx.entry.slug;
    if ((form.entry_slug || '').trim()) slug = renameEntry(db, ctx.entry, form.entry_slug);
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}/${slug}`);
  }));

  const entryActions: Array<[string, (db: any, ctx: any) => void, WebhookEvent]> = [
    ['publish', (db, ctx) => publishEntry(db, ctx.entry.id), 'entry.publish'],
    ['unpublish', (db, ctx) => unpublishEntry(db, ctx.entry.id), 'entry.unpublish'],
  ];
  for (const [actionName, fn, webhookEvent] of entryActions) {
    router.post(`/admin/projects/:slug/collections/:cslug/:eslug/${actionName}`, withEntry(async (req, res, params, ctx, db) => {
      fn(db, ctx);
      triggerWebhook(ctx.project, ctx.collection.slug, ctx.entry.slug, webhookEvent);
      redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}/${ctx.entry.slug}`);
    }));
  }

  router.post('/admin/projects/:slug/collections/:cslug/:eslug/delete', withEntry(async (req, res, params, ctx, db) => {
    const wasPublished = ctx.entry.status === 'published';
    deleteEntry(db, ctx.entry.id);
    if (wasPublished) {
      triggerWebhook(ctx.project, ctx.collection.slug, ctx.entry.slug, 'entry.delete');
    }
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}`);
  }));

  router.post('/admin/projects/:slug/collections/:cslug/:eslug/revert', withEntry(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const revisionId = Number.parseInt(form.revision_id, 10);
    try {
      revertToRevision(db, ctx.entry, revisionId);
    } catch (err) {
      return html(req, res, 400, entryEditorPage({ ...ctx, revisions: listRevisions(db, ctx.entry.id), ...editorMedia(ctx, db), notice: { type: 'error', message: err.message } }));
    }
    redirect(req, res, `/admin/projects/${ctx.project.slug}/collections/${ctx.collection.slug}/${ctx.entry.slug}`);
  }));

  // ---- API keys -----------------------------------------------------------

  router.get('/admin/projects/:slug/api-keys', withProject((req, res, params, ctx, db) => {
    html(req, res, 200, apiKeysPage({ ...ctx, keys: listApiKeys(db), collections: listCollections(db), origin: requestOrigin(req).origin, rateLimit: Number(getMeta(db, 'rate_limit_per_min')) || DEFAULT_RATE_LIMIT }));
  }));

  router.post('/admin/projects/:slug/api-keys', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const name = (form.name || '').trim();
    if (!name) return redirect(req, res, `/admin/projects/${ctx.project.slug}/api-keys`);
    const mcp = !!form.mcp;
    const createdKey = createApiKey(db, name, form.scope, mcp);
    html(req, res, 200, apiKeysPage({ ...ctx, keys: listApiKeys(db), createdKey, createdKeyMcp: mcp, collections: listCollections(db), origin: requestOrigin(req).origin, rateLimit: Number(getMeta(db, 'rate_limit_per_min')) || DEFAULT_RATE_LIMIT }));
  }));

  router.post('/admin/projects/:slug/api-keys/:keyId/revoke', withProject(async (req, res, params, ctx, db) => {
    revokeApiKey(db, Number.parseInt(params.keyId, 10));
    redirect(req, res, `/admin/projects/${ctx.project.slug}/api-keys`);
  }));

  router.post('/admin/projects/:slug/api-keys/:keyId/mcp', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    setApiKeyMcp(db, Number.parseInt(params.keyId, 10), form.mcp === '1');
    redirect(req, res, `/admin/projects/${ctx.project.slug}/api-keys`);
  }));

  router.post('/admin/projects/:slug/rate-limit', withProject(async (req, res, params, ctx, db) => {
    const form = await readFormBody(req);
    const n = Number.parseInt(form.rate_limit_per_min, 10);
    if (Number.isFinite(n) && n > 0) setMeta(db, 'rate_limit_per_min', String(n));
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

  // Consume one rate-limit token and set RateLimit-* headers on every
  // response. Returns false after sending the 429 when the bucket is empty.
  function applyRateLimit(req, res, bucketKey, limit) {
    const allowed = rateLimitOk(bucketKey, limit);
    for (const [h, v] of Object.entries(rateLimitHeaders(bucketKey, limit))) res.setHeader(h, v);
    if (allowed) return true;
    const retryAfter = retryAfterSeconds(bucketKey, limit);
    json(req, res, 429, { error: 'rate_limited', retry_after: retryAfter }, { 'Retry-After': String(retryAfter) });
    return false;
  }

  // Bearer-key project auth without a collection, for the schema routes.
  // Returns null after responding when auth fails.
  function apiProject(req, res, params, { write = false } = {}) {
    const project = getProjectBySlug(coreDb, params.project);
    if (!project) { json(req, res, 404, { error: 'not_found' }); return null; }
    const db = projectDbs.get(project.slug);
    const auth = req.headers.authorization || '';
    const apiKey = verifyApiKey(db, auth.startsWith('Bearer ') ? auth.slice(7) : null);
    if (!apiKey) { json(req, res, 401, { error: 'unauthorized' }); return null; }
    if (write && apiKey.scope !== 'write') {
      json(req, res, 403, { error: 'forbidden', message: 'A write-scope API key is required.' });
      return null;
    }
    return { project, db, apiKey };
  }

  // Schema routes register before the generic :collection routes so the
  // literal segments win the first-match router. (A collection slugged
  // exactly "schema" or "field-types" is shadowed on the list route; the
  // MCP tools still reach it.)

  router.get('/api/v1/:project/schema', (req, res, params) => {
    const ctx = apiProject(req, res, params);
    if (!ctx) return;
    json(req, res, 200, exportSchema(ctx.db));
  });

  router.get('/api/v1/:project/field-types', (req, res, params) => {
    if (!apiProject(req, res, params)) return;
    json(req, res, 200, describeFieldTypes());
  });

  // Apply a full schema document, same semantics as the MCP apply_schema
  // tool: match by slug, create or update, replace field lists wholesale.
  // ?delete_missing=1 also deletes collections absent from the document
  // (destructive: their entries go too).
  router.post('/api/v1/:project/schema', async (req, res, params) => {
    const ctx = apiProject(req, res, params, { write: true });
    if (!ctx) return;
    const rateLimit = Number(getMeta(ctx.db, 'rate_limit_per_min')) || DEFAULT_RATE_LIMIT;
    if (!applyRateLimit(req, res, `${ctx.project.slug}:${ctx.apiKey.id}`, rateLimit)) return;
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(req, res, 400, { error: 'bad_request', message: 'Body must be JSON: {collections: [...]}' });
    }
    const url = new URL(req.url, 'http://localhost');
    try {
      const report = applySchema(ctx.db, body, { deleteMissing: url.searchParams.get('delete_missing') === '1' });
      json(req, res, 200, report);
    } catch (err: any) {
      json(req, res, 400, { error: 'bad_request', message: err.message });
    }
  });

  router.get('/api/v1/:project/:collection', apiHandler((req, res, params, { db, collection, etag }) => {
    const url = new URL(req.url, 'http://localhost');
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;
    const updatedSince = url.searchParams.get('updated_since') ?? '';
    if (updatedSince && Number.isNaN(new Date(updatedSince).getTime())) {
      return json(req, res, 400, { error: 'invalid_updated_since', hint: 'ISO 8601 or "YYYY-MM-DD HH:MM:SS" (UTC)' });
    }
    json(req, res, 200, { items: listPublished(db, collection.id, { limit, offset, updatedSince }) }, { ETag: etag });
  }));

  router.get('/api/v1/:project/:collection/:entry', apiHandler((req, res, params, { db, collection, etag }) => {
    const item = getPublished(db, collection.id, params.entry);
    if (!item) return json(req, res, 404, { error: 'not_found' });
    json(req, res, 200, item, { ETag: etag });
  }));

  // Media upload for headless clients: multipart POST, same Bearer key auth
  // as MCP, write scope required. Unauthenticated requests get a bare 401
  // before the body is parsed. Fields: file (required), path (optional
  // folder prefix), storage, variants=1.
  router.post('/api/v1/:project/media', async (req, res, params) => {
    const project = getProjectBySlug(coreDb, params.project);
    if (!project) return json(req, res, 404, { error: 'not_found' });
    const db = projectDbs.get(project.slug);
    const auth = req.headers.authorization || '';
    const apiKey = verifyApiKey(db, auth.startsWith('Bearer ') ? auth.slice(7) : null);
    if (!apiKey) return json(req, res, 401, { error: 'unauthorized' });
    if (apiKey.scope !== 'write') return json(req, res, 403, { error: 'forbidden', message: 'A write-scope API key is required.' });
    const rateLimit = Number(getMeta(db, 'rate_limit_per_min')) || DEFAULT_RATE_LIMIT;
    if (!applyRateLimit(req, res, `${project.slug}:${apiKey.id}`, rateLimit)) return;
    let upload;
    try {
      upload = await readMultipart(req);
    } catch (err: any) {
      return json(req, res, 400, { error: 'bad_request', message: err.message });
    }
    const file = upload.files.file;
    if (!file) return json(req, res, 400, { error: 'bad_request', message: 'Multipart field "file" is required.' });
    try {
      const result = await apiUploadMedia(project, db, {
        filename: file.filename,
        mime: file.mime,
        data: file.data,
        path: upload.fields.path || '',
        storage: upload.fields.storage || '',
        variants: upload.fields.variants === '1',
      });
      json(req, res, 200, result);
    } catch (err) {
      if (err instanceof ToolError) return json(req, res, 400, { error: 'bad_request', message: err.message });
      throw err;
    }
  });

  // ---- MCP endpoint (per project, Bearer key, JSON-RPC over POST) ---------

  router.post('/mcp/:project', async (req, res, params) => {
    const project = getProjectBySlug(coreDb, params.project);
    if (!project) return json(req, res, 404, { error: 'not_found' });
    const db = projectDbs.get(project.slug);
    const auth = req.headers.authorization || '';
    const apiKey = verifyApiKey(db, auth.startsWith('Bearer ') ? auth.slice(7) : null);
    if (!apiKey) return json(req, res, 401, { error: 'unauthorized' });
    if (!apiKey.mcp) return json(req, res, 403, { error: 'forbidden', message: 'This API key does not have MCP access enabled.' });
    const rateLimit = Number(getMeta(db, 'rate_limit_per_min')) || DEFAULT_RATE_LIMIT;
    if (!applyRateLimit(req, res, `${project.slug}:${apiKey.id}`, rateLimit)) return;
    let message;
    try {
      message = JSON.parse(await readBody(req, { limit: MCP_BODY_LIMIT }));
    } catch (err: any) {
      if (err?.code === 'body_too_large') {
        // The unread rest of the body poisons the socket for keep-alive
        // reuse, so tell the client this connection is done.
        return json(req, res, 413, { error: 'body_too_large', limit_bytes: MCP_BODY_LIMIT }, { Connection: 'close' });
      }
      return json(req, res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } });
    }
    const response = await handleMcp(db, project.name, message, apiKey.scope, {
      uploadMedia: (args) => apiUploadMedia(project, db, args),
      onWebhook: (event: WebhookEvent, collectionSlug: string, entrySlug: string) => {
        triggerWebhook(project, collectionSlug, entrySlug, event);
      },
    });
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
    // Versioned URLs (?v=mtime, emitted by views) cache forever; bare URLs
    // revalidate so a deploy without a version bump still shows up.
    const versioned = new URL(req.url, 'http://localhost').searchParams.has('v');
    res.setHeader('Cache-Control', versioned ? 'public, max-age=31536000, immutable' : 'no-cache');
    const mtime = statSync(filePath).mtime;
    res.setHeader('Last-Modified', mtime.toUTCString());
    if (!versioned && req.headers['if-modified-since'] === mtime.toUTCString()) {
      res.writeHead(304);
      return res.end();
    }
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
    console.log(`Boring CMS listening on http://localhost:${app.appConfig.port}`);
  });
}
