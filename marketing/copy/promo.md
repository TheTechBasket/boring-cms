# Boring CMS promo copy

Copy and paste. Links: npm https://www.npmjs.com/package/boring-cms, site https://www.thetechbasket.com/boring-cms/, repo https://github.com/TheTechBasket/boring-cms

Numbers: 59 ms cold start (median of 7 boots, server ready), 65 MB idle memory, 0.23 ms p50 single-entry read (simulated 1 vCPU bench), 0 runtime dependencies, 533 KB unpacked. Re-measure before quoting after a release.

## Tagline

Boring CMS: the headless CMS that stays out of the way.

## One line (320 chars max, fits a repo description or tweet)

Headless CMS in one Node process with SQLite. 59 ms cold start, 65 MB idle, zero runtime dependencies. REST API, MCP server for AI agents, admin UI. Run it with `npx boring-cms`.

## Short (directory listings, 500 chars)

Boring CMS is a headless CMS that runs as a single Node process on SQLite. One deploy serves many projects, each with its own database, API keys and content model. It starts in 59 ms, idles at 65 MB and ships with zero runtime dependencies. You get an admin UI, a REST API with ETag caching, and a built-in MCP server so AI agents can manage content. Try it with `npx boring-cms`. MIT licensed.

## Long (Product Hunt, Show HN, dev.to, blog, README of awesome lists)

**Boring CMS: a headless CMS that does the boring parts well**

Most headless CMS setups ask for a database server, a build pipeline, a container, and a dashboard subscription before you write your first post. Boring CMS asks for Node 24 and one command:

```bash
npx boring-cms
```

Open the printed URL, create the admin account, add a project, and you have a content API. Data lives in one folder (`~/.boring-cms`) as plain SQLite files, so backup is a copy and moving servers is a copy.

**Why it exists**

I run many small sites and apps. Each needed the same thing: a place to edit content, an API to read it, and no operational overhead. Hosted CMS pricing scales with projects and seats. Self-hosted ones scale with moving parts. Boring CMS is one process, one folder, and no runtime dependencies to patch.

**What you get**

- Multi-project from day one. Each project is its own SQLite database with its own collections, API keys and content model.
- Content modeling in the admin: text, markdown, number, boolean, date, datetime, json, image, relation and counter fields, with required, unique, localized, hidden and read-only options.
- Draft and publish. Edits stay in draft, the API serves the published snapshot.
- Field-level revisions with configurable retention and atomic revert.
- REST API with Bearer keys (read and write scopes) and ETag responses, so clients get cheap 304s until the next publish.
- A per-project MCP server (Streamable HTTP). Point Claude, Cursor or any MCP client at it and an agent can list, create, edit and publish entries. Every MCP tool is also callable over REST.
- Media library on local disk or any S3-compatible store (R2, MinIO, S3), with optional resized variants when sharp is installed.
- Webhooks on publish, unpublish and delete.
- Full export and import in JSON and CSV, with dry-run preview and idempotent restore.
- Passkeys (WebAuthn), Google OAuth and email/password sign-in.
- Schema-as-code per project, so content models live in version control.
- Counter fields with drop-in scripts for likes, views, polls and quizzes. No separate backend needed for a static site.

**Fast because it is small**

Cold start is 59 ms (median of 7 boots, server ready) and idle memory is 65 MB. A single entry read takes 0.23 ms at p50 on a simulated 1 vCPU. The npm package is 533 KB unpacked with zero runtime dependencies, so there is nothing to audit, nothing to update weekly, and nothing that breaks on install. Every release is benchmarked and the results are published in the repo.

**Where it fits**

- Static sites: fetch posts at build time, render plain HTML.
- Mobile app backends: a read-only key, public counters, one small server.
- Private data: keys and scopes enforced server-side, database files never exposed over HTTP.
- AI workflows: agents write drafts over MCP, humans review and publish in the admin.

Five runnable demos with screenshots are in the demos repo, one per use case.

**Try it**

```bash
npx boring-cms
```

Needs Node 24. MIT licensed. Boring on purpose.

- npm: https://www.npmjs.com/package/boring-cms
- Site and launch video: https://www.thetechbasket.com/boring-cms/
- Source: https://github.com/TheTechBasket/boring-cms

## Social post (X, Mastodon, Bluesky)

Boring CMS: a headless CMS in one Node process.

59 ms cold start. 65 MB idle. 0 runtime dependencies. REST API, admin UI, and an MCP server so agents can publish for you.

npx boring-cms

https://www.thetechbasket.com/boring-cms/

## Reddit or forum post opener

I built a headless CMS that runs as one Node process on SQLite, with no runtime dependencies. It boots in 59 ms and idles at 65 MB. It has multi-project support, draft/publish, revisions, a REST API with ETag caching, and a per-project MCP server so AI agents can manage content. `npx boring-cms` to try it. Feedback welcome, especially on the content API and the MCP tools.

## Submission checklist (where to post)

- Show HN, Product Hunt, dev.to, Hacker Noon
- r/selfhosted, r/node, r/webdev, r/opensource
- Awesome lists: awesome-selfhosted, awesome-nodejs, awesome-headless-cms, awesome-mcp-servers
- Directories: AlternativeTo (vs Strapi, Directus, Payload), Console.dev, Node Weekly, Self-Hosted Weekly, MCP registries (mcp.so, Smithery, the official MCP registry)
- GitHub: repo description, topics (headless-cms, sqlite, mcp, nodejs, self-hosted), social preview image

## YouTube video

Video: https://youtu.be/dDszrCIEqZY (file `video/brag.mp4`, 23 s). Visibility must be Unlisted or Public before directories can embed it.

Title (A/B test set in YouTube Studio, three variants):

- Boring CMS: headless CMS in one Node process, 59 ms cold start
- A headless CMS with zero dependencies and a built-in MCP server
- Headless CMS in one Node process

Description (copy into Studio):

```
Boring CMS is a headless CMS that runs as a single Node process on SQLite. 59 ms cold start, 65 MB idle memory, 0.23 ms p50 entry read, zero runtime dependencies. Admin UI, REST API with ETag caching, and a built-in MCP server so AI agents can manage content. MIT licensed.

Try it: npx boring-cms (needs Node 24)

npm: https://www.npmjs.com/package/boring-cms
Site: https://www.thetechbasket.com/boring-cms/
Source: https://github.com/TheTechBasket/boring-cms

#headlesscms #nodejs #sqlite #selfhosted #mcp #opensource
```
