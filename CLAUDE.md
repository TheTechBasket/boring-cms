# yncms project instructions

- Icons: fetch SVGs with the allsvgicons MCP from the Solar icon pack (`solar:` prefix). Prefer the duotone variant (`*-bold-duotone`, then `*-line-duotone`) when one exists; fall back to linear/bold only if no duotone match. Inline the SVG in views, no icon font, no external requests.
- Zero runtime dependencies. sharp is the only optional dependency. No build step; TypeScript runs natively on Node 24.
- Views are server-rendered template strings in `lib/views.ts`; interactivity is vanilla JS in `public/admin.js`.
- After editing styles or views, run `pnpm css` and commit the built `public/admin.css`.
- Full checks before commit: `pnpm css`, `npx tsc --noEmit`, `pnpm smoke`.
