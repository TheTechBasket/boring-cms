import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './lib/config.js';
import { openCoreDb, ProjectDbManager } from './lib/db.js';
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
} from './lib/store.js';
import { signValue, verifySignedValue } from './lib/crypto.js';
import { Router, readFormBody, parseCookies, setCookie, clearCookie } from './lib/router.js';
import {
  setupPage,
  loginPage,
  resetPasswordPage,
  projectListPage,
  projectDetailPage,
  globalSettingsPage,
  errorPage,
} from './lib/views.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = 'yn_session';

export function createApp(configOverrides = {}) {
  const config = { ...loadConfig(__dirname), ...configOverrides };
  const migrationsDir = path.join(__dirname, 'migrations');
  const coreDb = openCoreDb(config.dataDir, migrationsDir);
  const projectDbs = new ProjectDbManager(config.dataDir, {
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
      const slug = (form.slug || '').trim().toLowerCase();
      if (!name || !isValidSlug(slug)) {
        return html(
          req,
          res,
          400,
          projectListPage({
            user,
            projects: listProjects(coreDb),
            notice: { type: 'error', message: 'Enter a name and a valid slug (lowercase letters, numbers, hyphens).' },
          }),
        );
      }
      if (getProjectBySlug(coreDb, slug)) {
        return html(
          req,
          res,
          409,
          projectListPage({
            user,
            projects: listProjects(coreDb),
            notice: { type: 'error', message: `Slug "${slug}" is already in use.` },
          }),
        );
      }
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
      html(req, res, 200, projectDetailPage({ user, project, settingKeys }));
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
      html(req, res, 200, globalSettingsPage({ user, settingKeys: listSettingKeys(coreDb, { scope: 'global' }) }));
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

  const server = http.createServer((req, res) => {
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
