// SQLite layer on node:sqlite (built in, Node 22+). Zero external deps.
//
// - core.db: migrations run at startup from migrations/*.sql, tracked in a
//   `migrations` table.
// - per-project DBs: lazily opened at data/projects/<slug>.db, idle handles
//   closed after IDLE_MS so 50 quiet projects cost near zero.
// - every DB gets WAL + synchronous=NORMAL.
// - every query is timed; anything over SLOW_QUERY_MS is recorded into
//   slow_queries (core.db) so the admin UI can show it.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const SLOW_QUERY_MS = 10;
const IDLE_MS = 5 * 60 * 1000;

function applyPragmas(db) {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
}

// Wraps a DatabaseSync so every .run/.get/.all call is timed and slow
// queries are logged. `onSlowQuery(sql, ms)` is called for slow ones;
// the caller (core db bootstrap) wires this to insert into slow_queries.
function instrument(db, dbName, onSlowQuery) {
  const rawPrepare = db.prepare.bind(db);
  // Statements are memoized per SQL text: the hot API path re-prepared the
  // same handful of queries on every request. Bounded so dynamic SQL cannot
  // grow it without limit.
  const cache = new Map();
  db.prepare = (sql) => {
    const hit = cache.get(sql);
    if (hit) return hit;
    const stmt = rawPrepare(sql);
    if (cache.size < 256) cache.set(sql, stmt);
    // Content generation: bumps on any write that can change API output, so the
    // response cache in server.ts drops itself. Decided once per statement.
    const touchesContent = /\b(entries|collections|meta)\b/i.test(sql);
    for (const method of ['run', 'get', 'all']) {
      const raw = stmt[method].bind(stmt);
      stmt[method] = (...args) => {
        const start = performance.now();
        const result = raw(...args);
        if (touchesContent && method === 'run') db.gen = (db.gen ?? 0) + 1;
        const ms = performance.now() - start;
        if (ms > SLOW_QUERY_MS && onSlowQuery) {
          onSlowQuery(dbName, sql, ms);
        }
        return result;
      };
    }
    return stmt;
  };
  return db;
}

export function openCoreDb(dataDir, migrationsDir) {
  mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'core.db');
  const db = new DatabaseSync(dbPath);
  applyPragmas(db);
  runMigrations(db, migrationsDir);

  const logSlowQuery = (dbName, sql, ms) => {
    try {
      db.prepare('INSERT INTO slow_queries (db, sql, duration_ms) VALUES (?, ?, ?)').run(dbName, sql, ms);
    } catch {
      // never let slow-query logging break the request path
    }
  };

  return instrument(db, 'core', logSlowQuery);
}

function runMigrations(db, migrationsDir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(db.prepare('SELECT name FROM migrations').all().map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
}

// ---- Per-project DB manager --------------------------------------------
//
// Lazily opens data/projects/<slug>.db on first use, keeps a handle per
// slug, and closes handles untouched for IDLE_MS.

export class ProjectDbManager {
  projectsDir: string;
  handles: Map<string, { db: any; lastUsed: number }>;
  onSlowQuery: any;
  migrationsDir: string | undefined;
  timer: any;

  constructor(dataDir, { onSlowQuery, migrationsDir }: { onSlowQuery?: any; migrationsDir?: string } = {}) {
    this.projectsDir = path.join(dataDir, 'projects');
    mkdirSync(this.projectsDir, { recursive: true });
    this.handles = new Map(); // slug -> { db, lastUsed }
    this.onSlowQuery = onSlowQuery;
    this.migrationsDir = migrationsDir; // migrations/project/*.sql, applied on open
    this.timer = setInterval(() => this.closeIdle(), 60 * 1000);
    this.timer.unref?.();
  }

  dbPath(slug) {
    return path.join(this.projectsDir, `${slug}.db`);
  }

  get(slug) {
    let entry = this.handles.get(slug);
    if (!entry) {
      const db = new DatabaseSync(this.dbPath(slug));
      applyPragmas(db);
      if (this.migrationsDir) runMigrations(db, this.migrationsDir);
      instrument(db, `project:${slug}`, this.onSlowQuery);
      entry = { db, lastUsed: Date.now() };
      this.handles.set(slug, entry);
    } else {
      entry.lastUsed = Date.now();
    }
    return entry.db;
  }

  closeIdle() {
    const now = Date.now();
    for (const [slug, entry] of this.handles) {
      if (now - entry.lastUsed > IDLE_MS) {
        entry.db.close();
        this.handles.delete(slug);
      }
    }
  }

  // Closes the handle (if open) and deletes the DB file. Used by project delete.
  destroy(slug) {
    const entry = this.handles.get(slug);
    if (entry) {
      entry.db.close();
      this.handles.delete(slug);
    }
    const file = this.dbPath(slug);
    if (existsSync(file)) unlinkSync(file);
    for (const suffix of ['-wal', '-shm']) {
      const f = file + suffix;
      if (existsSync(f)) unlinkSync(f);
    }
  }

  closeAll() {
    clearInterval(this.timer);
    for (const [, entry] of this.handles) entry.db.close();
    this.handles.clear();
  }

  get openCount() {
    return this.handles.size;
  }
}
