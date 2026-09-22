// Query layer over core.db: users, sessions, projects, settings.

import { hashPassword, verifyPassword, encryptSetting, decryptSetting, randomToken } from './crypto.ts';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---- Users --------------------------------------------------------------

export function userCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) ?? null;
}

export function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export async function createUser(db, { email, password, mustResetPassword = false }) {
  const passwordHash = await hashPassword(password);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, must_reset_password) VALUES (?, ?, ?)')
    .run(email, passwordHash, mustResetPassword ? 1 : 0);
  return getUserById(db, info.lastInsertRowid);
}

export async function verifyUserPassword(user, password) {
  return verifyPassword(password, user.password_hash);
}

export async function setUserPassword(db, userId, password, { mustResetPassword = false, keepSessionId = null } = {}) {
  const passwordHash = await hashPassword(password);
  db.prepare(
    "UPDATE users SET password_hash = ?, must_reset_password = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(passwordHash, mustResetPassword ? 1 : 0, userId);
  // Password change revokes every other session for this user (stolen
  // cookie mitigation). The caller's own session is kept so the change
  // does not log them out mid-request.
  if (keepSessionId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSessionId);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

// ---- Sessions -------------------------------------------------------------

export function createSession(db, userId) {
  const id = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expiresAt);
  return id;
}

export function getSession(db, id) {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(db, id);
    return null;
  }
  return row;
}

export function deleteSession(db, id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

// ---- WebAuthn credentials -------------------------------------------------

export function addCredential(db, { userId, name, credentialId, publicKeyJwk, counter, transports = [] }) {
  db.prepare('INSERT INTO credentials (user_id, name, credential_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, name || 'Passkey', credentialId, JSON.stringify(publicKeyJwk), counter, JSON.stringify(transports));
}

export function listCredentials(db, userId) {
  return db.prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY id').all(userId);
}

export function credentialCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM credentials').get().n;
}

export function getCredentialByCredId(db, credentialId) {
  return db.prepare('SELECT * FROM credentials WHERE credential_id = ?').get(credentialId) ?? null;
}

export function updateCredentialCounter(db, id, counter) {
  db.prepare('UPDATE credentials SET counter = ? WHERE id = ?').run(counter, id);
}

export function deleteCredential(db, userId, id) {
  db.prepare('DELETE FROM credentials WHERE id = ? AND user_id = ?').run(id, userId);
}

// ---- Projects ---------------------------------------------------------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

export function listProjects(db) {
  return db.prepare('SELECT * FROM projects ORDER BY name').all();
}

export function getProjectBySlug(db, slug) {
  return db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) ?? null;
}

export function getProjectById(db, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) ?? null;
}

export function createProject(db, { slug, name }) {
  const info = db.prepare('INSERT INTO projects (slug, name) VALUES (?, ?)').run(slug, name);
  return getProjectById(db, info.lastInsertRowid);
}

export function renameProject(db, slug, name, icon = null) {
  db.prepare("UPDATE projects SET name = ?, icon = COALESCE(?, icon), updated_at = datetime('now') WHERE slug = ?").run(name, icon, slug);
}

export function deleteProjectRow(db, slug) {
  db.prepare('DELETE FROM projects WHERE slug = ?').run(slug);
}

// ---- Settings (encrypted) ----------------------------------------------
//
// scope: 'global' (project_id NULL) or 'project' (project_id set).
// Values are never returned in plaintext except via getSettingValue, which
// callers should use only for internal use, never to render back to a UI.

// Note: the UNIQUE(scope, project_id, key) index does not dedupe global
// settings via ON CONFLICT, because SQLite treats every NULL project_id as
// distinct for uniqueness purposes. So this upserts by hand instead.
export function setSetting(db, masterKey, { scope, projectId = null, key, value }) {
  const { iv, ciphertext, tag } = encryptSetting(masterKey, value);
  const existing = db
    .prepare('SELECT id FROM settings WHERE scope = ? AND project_id IS ? AND key = ?')
    .get(scope, projectId, key);
  if (existing) {
    db.prepare(
      "UPDATE settings SET iv = ?, ciphertext = ?, tag = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(iv, ciphertext, tag, existing.id);
  } else {
    db.prepare(
      'INSERT INTO settings (scope, project_id, key, iv, ciphertext, tag) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(scope, projectId, key, iv, ciphertext, tag);
  }
}

export function deleteSetting(db, { scope, projectId = null, key }) {
  db.prepare('DELETE FROM settings WHERE scope = ? AND project_id IS ? AND key = ?').run(scope, projectId, key);
}

export function getSettingValue(db, masterKey, { scope, projectId = null, key }) {
  const row = db
    .prepare('SELECT iv, ciphertext, tag FROM settings WHERE scope = ? AND project_id IS ? AND key = ?')
    .get(scope, projectId, key);
  if (!row) return null;
  return decryptSetting(masterKey, row);
}

// Lists settings for a scope, set/unset only, never the decrypted value.
export function listSettingKeys(db, { scope, projectId = null }) {
  return db
    .prepare('SELECT key, updated_at FROM settings WHERE scope = ? AND project_id IS ? ORDER BY key')
    .all(scope, projectId);
}
