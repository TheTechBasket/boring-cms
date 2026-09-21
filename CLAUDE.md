# Boring CMS project instructions

- No emoji anywhere in this project: UI copy, docs, commit messages, code comments. Exception: the project icon feature accepts user-entered emoji as data.
- Icons: fetch SVGs with the allsvgicons MCP from the Solar icon pack (`solar:` prefix). Prefer the duotone variant (`*-bold-duotone`, then `*-line-duotone`) when one exists; fall back to linear/bold only if no duotone match. Inline the SVG in views, no icon font, no external requests.
- Zero runtime dependencies. sharp is the only optional dependency. No build step; TypeScript runs natively on Node 24.
- npm tarball ships runtime files only. Never add anything to the package.json `files` list that the server does not need at runtime (no docs, no plans, no bench). Check with `npm pack --dry-run`.
- Views are server-rendered template strings in `lib/views.ts`; interactivity is vanilla JS in `public/admin.js`.
- After editing styles or views, run `pnpm css` and commit the built `public/admin.css`.
- Full checks before commit: `pnpm css`, `npx tsc --noEmit`, `pnpm smoke`.
- New functionality (endpoint, MCP tool, data operation, anything with a runtime cost): add a matching phase to `bench/bench.mjs` covering it, then run the benchmark before push. Catch perf regressions and bugs early, not from a production timeout.
