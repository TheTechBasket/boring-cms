// Universal export/import + schema-as-code. Zero deps, CSV hand-rolled.

import {
  FIELD_TYPES,
  listCollections,
  getCollection,
  addCollectionField,
  createEntry,
  updateEntry,
  publishEntry,
  bumpContentVersion,
} from './content.ts';

// ---- Export ---------------------------------------------------------------

export function exportSchema(db) {
  return {
    collections: listCollections(db).map((c) => ({ name: c.name, slug: c.slug, fields: c.fields })),
  };
}

export function exportCollection(db, collection) {
  const entries = db
    .prepare('SELECT slug, status, data FROM entries WHERE collection_id = ? ORDER BY id')
    .all(collection.id)
    .map((r) => ({ slug: r.slug, status: r.status, data: JSON.parse(r.data) }));
  return { collection: { name: collection.name, slug: collection.slug, fields: collection.fields }, entries };
}

export function exportProject(db, project) {
  return {
    project: project.slug,
    schema: exportSchema(db),
    collections: listCollections(db).map((c) => exportCollection(db, c)),
  };
}

// ---- Schema apply ---------------------------------------------------------

// Idempotent: create missing collections, update changed ones, never delete
// unless deleteMissing is explicitly true (extra collections are listed).
export function applySchema(db, schema, { deleteMissing = false } = {}) {
  const incoming = schema?.collections;
  if (!Array.isArray(incoming)) throw new Error('Schema must be an object with a collections array.');
  for (const c of incoming) {
    if (!c?.slug || !c?.name || !Array.isArray(c.fields)) {
      throw new Error('Each collection needs slug, name and a fields array.');
    }
    for (const f of c.fields) {
      if (!f?.name || !f?.label || !FIELD_TYPES.includes(f.type)) {
        throw new Error(`Bad field in "${c.slug}": each field needs name, label and a known type.`);
      }
    }
  }
  const report = { created: [], updated: [], unchanged: [], missing: [], deleted: [] };
  for (const c of incoming) {
    const existing = getCollection(db, c.slug);
    if (!existing) {
      db.prepare('INSERT INTO collections (slug, name, fields) VALUES (?, ?, ?)').run(c.slug, c.name, JSON.stringify(c.fields));
      report.created.push(c.slug);
    } else if (existing.name !== c.name || JSON.stringify(existing.fields) !== JSON.stringify(c.fields)) {
      db.prepare('UPDATE collections SET name = ?, fields = ? WHERE id = ?').run(c.name, JSON.stringify(c.fields), existing.id);
      report.updated.push(c.slug);
    } else {
      report.unchanged.push(c.slug);
    }
  }
  const incomingSlugs = new Set(incoming.map((c) => c.slug));
  for (const c of listCollections(db)) {
    if (incomingSlugs.has(c.slug)) continue;
    if (deleteMissing) {
      db.prepare('DELETE FROM collections WHERE id = ?').run(c.id);
      report.deleted.push(c.slug);
    } else {
      report.missing.push(c.slug);
    }
  }
  if (report.created.length || report.updated.length || report.deleted.length) bumpContentVersion(db);
  return report;
}

// ---- Import parsing -------------------------------------------------------

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [header, ...data] = rows;
  if (!header) return { sourceFields: [], rows: [] };
  return {
    sourceFields: header,
    rows: data.map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])) as Record<string, any>),
  };
}

// Accepts CSV, a JSON array of flat objects, or a Boring CMS collection export.
// Export-shape status survives as __status so publish state re-materializes.
export function parseImportFile(filename: string, buffer: Buffer) {
  const text = buffer.toString('utf8');
  if (/\.csv$/i.test(filename)) return parseCsv(text);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('File is neither valid JSON nor named .csv.'); }
  let rows;
  if (Array.isArray(parsed)) rows = parsed;
  else if (Array.isArray(parsed?.entries)) rows = parsed.entries.map((e) => ({ __status: e.status, ...(e.data ?? {}) }));
  else throw new Error('JSON must be an array of objects or a Boring CMS collection export.');
  rows = rows.filter((r) => r && typeof r === 'object' && !Array.isArray(r));
  if (!rows.length) throw new Error('No rows found in the file.');
  const sourceFields = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== '__status');
  return { sourceFields, rows };
}

// ---- Coercion -------------------------------------------------------------

const TRUE_WORDS = ['1', 'true', 'yes', 'on'];
const BOOL_WORDS = [...TRUE_WORDS, '0', 'false', 'no', 'off', ''];

// Never fatal: ok=false keeps the raw value and gets counted in the report.
export function coerceValue(type: string, raw: any) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: type === 'boolean' ? false : type === 'number' ? null : '', ok: true };
  }
  switch (type) {
    case 'number': {
      const n = Number(raw);
      return Number.isNaN(n) ? { value: raw, ok: false } : { value: n, ok: true };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw, ok: true };
      const s = String(raw).trim().toLowerCase();
      return { value: TRUE_WORDS.includes(s), ok: BOOL_WORDS.includes(s) };
    }
    case 'date': {
      const s = String(raw).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { value: s, ok: true } : { value: String(raw), ok: false };
    }
    case 'json': {
      if (typeof raw === 'object') return { value: raw, ok: true };
      try { return { value: JSON.parse(raw), ok: true }; } catch { return { value: raw, ok: false }; }
    }
    default:
      return { value: typeof raw === 'string' ? raw : String(raw), ok: true };
  }
}

// ---- Import plan/apply ----------------------------------------------------

// mapping: { [sourceField]: 'field:<name>' | 'create:<type>' | 'skip' }.
// uniqueField: target field name; matching rows update instead of duplicate.
// Same code runs the dry run (dryRun: true) and the real write, so the
// report the user confirmed is exactly what happens.
export function applyImport(db, collectionSlug: string, rows: any[], mapping: Record<string, string>, uniqueField: string, { dryRun = false } = {}) {
  let collection = getCollection(db, collectionSlug);
  if (!collection) throw new Error('Collection not found.');

  const report: any = { total: rows.length, created: 0, updated: 0, newFields: [], coercionFailures: {}, sample: [] };
  // Resolve mapping into [sourceField, targetName, type], creating fields.
  const resolved: Array<[string, string, string]> = [];
  for (const [source, action] of Object.entries(mapping)) {
    if (action === 'skip' || !action) continue;
    if (action.startsWith('create:')) {
      const type = action.slice(7);
      if (!FIELD_TYPES.includes(type)) throw new Error(`Unknown field type: ${type}`);
      report.newFields.push({ label: source, type });
      if (!dryRun) {
        collection = addCollectionField(db, collection.slug, { label: source, type });
        resolved.push([source, collection.fields[collection.fields.length - 1].name, type]);
      } else {
        resolved.push([source, source, type]);
      }
    } else if (action.startsWith('field:')) {
      const name = action.slice(6);
      const target = collection.fields.find((f) => f.name === name);
      if (!target) throw new Error(`Unknown target field: ${name}`);
      resolved.push([source, name, target.type]);
    }
  }
  if (!resolved.length) throw new Error('Map at least one field.');

  const existing = uniqueField
    ? db.prepare('SELECT id, slug, data, status FROM entries WHERE collection_id = ?').all(collection.id)
        .map((r) => ({ ...r, data: JSON.parse(r.data) }))
    : [];

  for (const row of rows) {
    const data: Record<string, any> = {};
    for (const [source, target, type] of resolved) {
      const { value, ok } = coerceValue(type, row[source]);
      data[target] = value;
      if (!ok) report.coercionFailures[target] = (report.coercionFailures[target] || 0) + 1;
    }
    if (report.sample.length < 3) report.sample.push(data);
    const match = uniqueField
      ? existing.find((e) => String(e.data[uniqueField] ?? '') === String(data[uniqueField] ?? '') && data[uniqueField] !== undefined && data[uniqueField] !== '')
      : null;
    if (match) {
      report.updated++;
      if (!dryRun) updateEntry(db, match, { data: { ...match.data, ...data } });
    } else {
      report.created++;
      if (!dryRun) {
        const entry = createEntry(db, collection, { data });
        if (row.__status === 'published') publishEntry(db, entry.id);
        if (uniqueField) existing.push({ id: entry.id, slug: entry.slug, data, status: entry.status });
      }
    }
  }
  return report;
}
