# Publishing to npm

The npm package is how users run Boring CMS without cloning:
`npx boring-cms` (also `pnpm dlx` / `bunx`). This file is the whole flow.

## What gets published

The `files` field in `package.json` is the canonical list. Currently:

- `bin/` (the `boring-cms` launcher)
- `server.js` and `lib/*.js` (built at pack time, see below; the `.ts`
  sources are NOT shipped because Node refuses type stripping for files
  under `node_modules`)
- `migrations/` (core and per-project SQL)
- `public/` (built admin CSS/JS, committed to the repo, no pack-time build)
- `.env.example` (read at runtime: it is the template for the generated
  first-boot `.env`)
- `README.md`, `LICENSE`, `package.json` (always included by npm itself)

Nothing else. The rule: only files the server needs at runtime go in the
tarball. Docs like `ARCHITECTURE.md` and this file live in the repo.

Sanity check the exact list any time with `npm pack --dry-run`.

## How the build works

There is no build step in the repo; the only build is at pack time. The
`prepack` script runs `tsc -p tsconfig.build.json`, which emits
type-stripped `.js` next to each `.ts` source and rewrites relative
`.ts` imports to `.js`. The `postpack` script deletes the emitted files
again, so the working tree stays clean and `.js` never gets committed
(also enforced by `.gitignore`). You never run the build by hand; `npm
pack` and `npm publish` trigger it.

## Release steps

1. Working tree clean, version bumped in `package.json` (semver: patch
   for fixes, minor for features), `CHANGELOG.md` has the release section.
2. Local checks:

   ```bash
   pnpm css          # only if styles or views changed
   npx tsc --noEmit
   ```

3. Verify the actual package (the gate that catches packaging bugs the
   repo checks cannot see):

   ```bash
   pnpm verify:pack
   ```

   This builds the real tarball, asserts no `.ts` inside, installs it in
   a temp directory, boots the packaged server with an isolated home,
   asserts `/admin/login` answers, then runs the smoke suite and the
   full benchmark against the packaged server (every phase must finish
   with zero errors). Do not publish on a failure.

4. Publish (needs npm login and a 2FA one-time password):

   ```bash
   npm publish --access public --otp=XXXXXX
   ```

5. Verify the published version from a clean directory:

   ```bash
   cd $(mktemp -d) && npx boring-cms@latest
   ```

   Expect "Boring CMS home: ~/.boring-cms" and a listening line; open
   `http://localhost:3000` and see `/setup` or `/login`.

6. Tag and push:

   ```bash
   git tag v<version>
   git push && git push --tags
   ```

## If a published version is broken

Within 72 hours and with no dependents, remove it:

```bash
npm unpublish boring-cms@<version> --otp=XXXXXX
```

Older than that, deprecate instead:

```bash
npm deprecate boring-cms@<version> "broken, use latest" --otp=XXXXXX
```

Then fix, bump the patch version, and go through the steps again. Never
republish the same version number; npm forbids it forever, even after an
unpublish.
