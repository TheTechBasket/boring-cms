# Backup and restore

## Why

No backup functionality exists today. Per-project SQLite files make single-project
restore simple (see [server-architecture-rules] data layout: `data/core.db` plus one
`data/projects/<slug>.db` per project), but `.env`'s `SECRET_KEY` is the trap: it
protects session cookies and encrypted Settings values (`lib/crypto.ts`,
`lib/store.ts:setSetting`/`getSettingValue`), not collection content, which is stored
plain. Bundling `SECRET_KEY` into routine backups is the devastating case: leak the
tarball, leak the key. Never bundling it is also a trap: restore to a fresh box with a
freshly generated key and every encrypted Setting is permanently unreadable, silently,
until someone hits a decrypt error.

## What SECRET_KEY protects (confirmed 2026-09-23)

- Session cookies (HMAC sign/verify). Lost key: everyone logged out, re-login only, no
  data loss.
- Settings values (AES-256-GCM), the Settings feature's stored credentials (API keys,
  storage secrets). Lost key: those specific rows permanently unreadable.
- Passwords use scrypt, independent of SECRET_KEY, unaffected either way.
- Collection/entry content is not encrypted. A restore mismatch never touches actual
  CMS content.

## Design

- [ ] Data backup (routine, automated): `data/core.db` + `data/projects/<slug>.db` +
      `data/media/`. Never includes `.env`. Per-project restore is a plain file copy,
      already safe today because SECRET_KEY lives outside project scope.
- [ ] Key backup (one-time, out of band): at backup time, also snapshot the current
      `SECRET_KEY` value into the same backup's manifest, encrypted or clearly
      separated from the data files, e.g. `backup/<date>/secret_key.txt` written with
      `0o600`, called out in the backup tool's output as the one file to store
      somewhere other than next to the data (password manager, secrets vault). Keeping
      it in the backup (not hand-copying `.env` separately) means it is never
      forgotten; keeping it as a distinct artifact (not bundled into the data archive)
      means it can be handled with different care, e.g. left out of an offsite copy
      that isn't fully trusted.
- [ ] Restore flow: on `data/` restore to a box whose current `SECRET_KEY` fails to
      decrypt a known row, do not fail silently. Prompt for the key that was backed up
      alongside that data (`secret_key.txt` from the same backup). Verify it decrypts;
      if it does, offer to re-encrypt every Settings row under the box's current
      SECRET_KEY and adopt the new key going forward (migrate-and-drop-old), so the
      box never has to keep running on an imported key permanently. Sessions signed
      under the old key are simply invalid either way; no special handling needed
      beyond the existing "you're logged out."
- [ ] Sanity check on any restore: immediately try `decryptSetting` on one known
      encrypted row; fail loud if it does not decrypt, rather than a Settings page
      that quietly renders garbage later.
- [ ] Bench: add a phase once backup/restore ships (endpoint or CLI both count as
      runtime cost per CLAUDE.md).

## Verification

- [ ] Restore one project's `.db` on the same server: settings decrypt clean, no key
      prompt.
- [ ] Restore full `data/` on a fresh server with only the data archive: key prompt
      fires, decrypt fails without the key, succeeds once the key is supplied.
- [ ] After supplying the old key and choosing migrate: Settings readable under the
      new box's key, old key file no longer needed.
