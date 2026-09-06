# Stage 4: Universal export and import (content + schema)

**Goal**

Move content in and out of any platform without per-platform importers. Export a collection or project as JSON. Import JSON or CSV with an in-browser field mapping step and a schema check before anything is written. Schema itself is a first-class export: a full site (all collections and fields) can be written as one JSON file by hand or by code and applied directly, so nothing in the admin needs clicking twice.

**Decisions**

- Export: one JSON file per collection (`{ collection, fields, entries: [{ slug, status, data }] }`) or a whole-project bundle (`{ project, collections: [...] }`). Download from the admin. Published snapshots not exported; publish state is, re-materialized on import.
- Import formats: JSON (our export shape or any array of flat objects) and CSV (header row = source fields). Parsed client-side? No: file uploads through the existing multipart parser, parsed server-side, but nothing written until mapping is confirmed.
- Two-step flow: upload -> mapping screen showing source fields against target collection fields (dropdown per source field: map to existing field, create new field with type select, or skip) -> dry-run schema check (row count, type mismatches, sample values) -> confirm -> write.
- Type coercion on import: numbers and booleans parsed from strings, dates validated ISO-ish, json fields parsed when valid (same keep-raw-on-failure rule as the editor). Mismatches listed in the report, never fatal per row.
- Idempotency: optional "unique field" select on mapping; when set, re-import updates matching entries instead of duplicating. Otherwise every row is a new entry with a fresh UUID.
- Import writes go through lib/content.ts (createEntry/updateEntry) so revisions stay intact.
- Pending mapping state held in a temp JSON file under the scratchdir keyed by an id in the form, not in memory, so a restart mid-flow loses nothing important.
- WordPress migration happens through this path: convert WXR to JSON with a one-off external script, then import. No WXR code in the CMS.
- Schema-as-code: `GET .../schema.json` exports the project schema (collections, fields, order). Apply route takes the same shape and syncs: create missing collections/fields, update field labels/types/order, never delete anything automatically (removals listed in the report, deleted only with an explicit checkbox). Idempotent, so a schema file in a site repo is the source of truth and re-applying is safe.
- Content export embeds the schema block, so one file can restore a whole project (schema apply first, then rows).

**Checklist**

- [ ] Schema export route + apply route with sync report (create/update, deletions opt-in).
- [ ] Export: collection JSON download route + project bundle route (schema embedded), buttons in the admin.
- [ ] Import upload route (JSON + CSV parse, temp file with parsed rows + detected source fields).
- [ ] Mapping screen: source fields vs target fields, create-new-field option, unique-field select.
- [ ] Dry-run check + report (counts, coercion failures, sample).
- [ ] Confirm route: write rows through content.ts, coercion rules, idempotent update path.
- [ ] Smoke: export a collection, reimport into a fresh collection with mapping, assert entries + types; CSV path; unique-field re-import updates not duplicates.
- [ ] README import/export section.

**Verification**

- pnpm smoke green.
- Manual: export from one project, import into another with a renamed field mapped, verify entries and publish state.
