# Boring CMS guide

Boring CMS is a headless CMS you call over REST or MCP: define collections with typed fields, write entries, publish, and read them from any site. This guide is for developers and agents that build on it.

## Fields

A collection is a list of fields. There are 10 types; every one accepts the universal options `required`, `unique`, `help`, `placeholder` and `default`. Entry data is stored as JSON keyed by field name, so agents read and write plain objects.

| Type | Value you send and read | Type options | Use it for |
| --- | --- | --- | --- |
| `text` | string | `minlength`, `maxlength`, `pattern` | Titles, names, short copy, slugs of your own, tags as a string |
| `markdown` | string (Markdown source) | `minlength`, `maxlength`, `pattern` | Article bodies, long descriptions. Render on your side |
| `number` | number | `min`, `max`, `step` (editor only) | Prices, ratings, sort order, stock |
| `boolean` | true or false | none | Flags: featured, hidden, published-on-site toggles |
| `date` | "YYYY-MM-DD" | `min`, `max` | Event day, release day, birthdays |
| `datetime` | "YYYY-MM-DDTHH:MM:SSZ" (UTC) | `min`, `max` | Start times, deadlines, anything with a clock |
| `json` | any JSON value | none | Free-form settings, structured blobs, arrays of objects |
| `image` | string (media path or URL) | `minlength`, `maxlength`, `pattern`, `accept` | Hero images, avatars. Upload with the media endpoint or `upload_media` |
| `relation` | entry slug, or array of slugs | `collection` (required), `multiple` | Post to author, product to categories, quiz to questions |
| `counter` | `{up, down}`, read from the counter endpoints | `access`: "public" (default) or "key" | Likes, votes, page views, poll and quiz answers. See the next section |

Rules that trip agents up:

- `counter` values are never part of the entry payload. You cannot set them by writing an entry. Read and change them only through the counter endpoints.
- Field names `slug`, `updated_at` and `published_at` are reserved.
- A relation stores slugs, not embedded entries. Fetch the target collection and join on your side.
- `unique` and `required` are checked on save, not on publish.
- Ask the live server for the exact current list with `GET /api/v1/<project>/field-types` or the `describe_field_types` MCP tool. That output is the source of truth.

Field names are slugified on save: `opt_a` becomes `opt-a`. Use the hyphenated form in URLs, `data-cms-option` and every API call.

## The counter field

A counter field keeps two totals per entry, `up` and `down`, outside the entry payload. Voting never changes the entry, its ETag, its revisions or its webhooks, so a cached page stays cached while votes come in.

| Endpoint | Auth | What it does |
| --- | --- | --- |
| `POST /api/v1/<project>/<collection>/<entry>/counters/<field>?dir=up` | none for public fields, write key for `access: key` | Add a vote. `dir` is `up` (default) or `down`. Returns `{up, down, changed}` |
| `GET /api/v1/<project>/<collection>/<entry>/counters` | none for public fields, a key also returns private ones | Totals for every counter field on one entry |
| `GET /api/v1/<project>/<collection>/counters?slugs=a,b,c` | same | Totals for up to 100 entries at once, for list pages |

The entry must be published and past its go-live time, otherwise every counter route answers 404. CORS is open on these routes, so a static site on any domain can call them from the browser.

### What one counter field can be

- **Up and down votes**: two buttons, show `up`, `down` or `up - down`.
- **Page views**: a public field where each page load sends `up`. Read `up` as unique visitors per day, not raw hits (see below).
- **Poll**: one counter field per option on a single entry (`opt_a`, `opt_b`, `opt_c`). The result of an option is its `up` total.
- **Quiz**: a poll with a known right answer. Keep the answer in your page, not the CMS, and count options as in a poll.
- **Private tally** (`access: key`): a write key adds any step from 1 to 1000 with `?by=`, with no dedupe. Use it for server-side counts such as downloads or purchases. Never expose that key in a browser.

### How dedupe really works

- The server remembers a voter as a salted hash of project, IP, user agent, entry and field. Same direction again is ignored (`changed: false`). The opposite direction switches the vote, so `up` drops by 1 and `down` rises by 1.
- That memory lives in RAM for 24 hours and is dropped on restart. Two people on one network with the same browser string can look like one voter.
- There is no unvote endpoint. A vote can only be switched, not withdrawn.
- Totals are flushed to the database every 5 seconds. A hard crash can lose the last 5 seconds of votes.
- Public votes are rate limited per IP if the project owner sets a vote limit. New projects start with the limit off.
- Because the server cannot know a person, a browser check in `localStorage` is the friendly guard, and the server dedupe is the backstop. Neither stops someone determined. Treat public counters as soft signals, never as a real election.

## Minimal script (proof of concept)

The smallest thing that works: one like button, one count, one vote per browser per post. Six lines of script, no settings beyond the three at the top. Use it to prove the idea, then move to the drop-in script below for down votes, views, polls and quizzes.

Setup: a public counter field `likes` on collection `posts`, and a published entry whose slug is the last part of the page URL (for example `/posts/hello-world` uses entry `hello-world`).

```html
<button data-like>Like <b>0</b></button>
<script>
const BASE = 'https://cms.example.com/api/v1/blog/posts/' + location.pathname.split('/').filter(Boolean).pop() + '/counters';
const btn = document.querySelector('[data-like]'), num = btn.querySelector('b'), KEY = 'liked:' + BASE;
fetch(BASE).then(r => r.json()).then(t => (num.textContent = t.likes?.up ?? 0));
btn.onclick = () => localStorage[KEY] || fetch(BASE + '/likes', { method: 'POST' }).then(r => r.json()).then(t => { num.textContent = t.up; localStorage[KEY] = 1; });
</script>
```

Change the three parts of `BASE` to fit: host, project (`blog`) and collection (`posts`). The `localStorage` key includes the full URL, so every post is remembered separately and a visitor can like many posts, once each. This version has no unlike. Clearing browser storage allows another vote, and the server dedupe (see above) is the only other guard.

## Drop-in script

One inline script, no dependencies, about 4 KB. Put it once at the end of the page. It finds elements by `data-cms-*` attributes, reads totals with one GET per entry, and sends votes with POST. Verified in a browser against a live server: voting, switching, reload persistence, poll change and quiz marking all behave as described below.

Settings are read from the element or its nearest ancestor, so set them once on `<body>` or a wrapper and override per widget.

| Attribute | Default | Meaning |
| --- | --- | --- |
| `data-cms-base` | `window.CMS_BASE`, else same origin | CMS origin, e.g. https://cms.example.com |
| `data-cms-project` | `window.CMS_PROJECT` | Project slug |
| `data-cms-collection` | `posts` | Collection slug |
| `data-cms-entry` | last segment of the page URL, else `home` | Entry slug the votes belong to |
| `data-cms-field` | `likes` for votes, `views` for views | Counter field name |

Browser memory: every vote is stored in one `localStorage` key, `bcms-votes`, as `project/collection/entry/field` to `up`, `down` or a timestamp. That is why one visitor can vote on many posts and quizzes but only once on each. Page views store a timestamp and count again after 24 hours. If storage is blocked the widgets still work; they just cannot remember the visitor.

```html
<script>
(() => {
  const LS = 'bcms-votes', D = document;
  const read = () => { try { return JSON.parse(localStorage[LS]) || {}; } catch { return {}; } };
  const save = (k, v) => { try { localStorage[LS] = JSON.stringify({ ...read(), [k]: v }); } catch {} };
  // Setting resolution: the element or the nearest ancestor with the attribute, else the default.
  const cfg = (el, k, d) => el.closest(`[data-cms-${k}]`)?.getAttribute(`data-cms-${k}`) ?? d;
  const target = (el) => {
    const base = cfg(el, 'base', window.CMS_BASE || ''), project = cfg(el, 'project', window.CMS_PROJECT || '');
    const coll = cfg(el, 'collection', 'posts');
    const entry = cfg(el, 'entry', location.pathname.replace(/\/+$/, '').split('/').pop() || 'home');
    return { url: `${base}/api/v1/${project}/${coll}/${entry}/counters`, id: `${project}/${coll}/${entry}` };
  };
  const cache = {};
  const totals = (t) => (cache[t.url] ||= fetch(t.url).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  const vote = (t, field, dir) => fetch(`${t.url}/${field}?dir=${dir}`, { method: 'POST' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  const text = (root, sel, fn) => root.querySelectorAll(sel).forEach((n) => (n.textContent = fn(n)));

  // Up/down votes: <div data-cms-counter> with [data-cms-vote=up|down] and [data-cms-count=up|down|net].
  D.querySelectorAll('[data-cms-counter]').forEach(async (el) => {
    const t = target(el), field = cfg(el, 'field', 'likes'), key = `${t.id}/${field}`;
    let n = (await totals(t))[field] || { up: 0, down: 0 };
    const paint = () => {
      text(el, '[data-cms-count]', (c) => (c.dataset.cmsCount === 'net' ? n.up - n.down : n[c.dataset.cmsCount]));
      el.querySelectorAll('[data-cms-vote]').forEach((b) => b.setAttribute('aria-pressed', String(read()[key] === b.dataset.cmsVote)));
    };
    paint();
    el.querySelectorAll('[data-cms-vote]').forEach((b) => (b.onclick = async () => {
      const dir = b.dataset.cmsVote;
      if (read()[key] === dir) return; // already voted this way on this browser
      try { n = await vote(t, field, dir); save(key, dir); paint(); } catch {}
    }));
  });

  // Page views: <span data-cms-views>. Counts once per browser per 24h. data-cms-views="show" only displays.
  D.querySelectorAll('[data-cms-views]').forEach(async (el) => {
    const t = target(el), field = cfg(el, 'field', 'views'), key = `${t.id}/${field}`;
    let n;
    if (el.dataset.cmsViews !== 'show' && Date.now() - (read()[key] || 0) > 864e5) {
      try { n = await vote(t, field, 'up'); save(key, Date.now()); } catch {}
    }
    n ||= (await totals(t))[field];
    el.textContent = n ? n.up : 0;
  });

  // Poll or quiz: <div data-cms-poll> with [data-cms-option=<counter field>] buttons.
  // Optional: data-cms-correct=<field> (quiz), data-cms-change (allow switching the answer).
  D.querySelectorAll('[data-cms-poll]').forEach(async (el) => {
    const t = target(el), key = `${t.id}/poll`, opts = [...el.querySelectorAll('[data-cms-option]')];
    const n = await totals(t);
    const paint = () => {
      const up = (o) => n[o.dataset.cmsOption]?.up || 0, sum = opts.reduce((a, o) => a + up(o), 0), mine = read()[key], right = el.dataset.cmsCorrect;
      opts.forEach((o) => {
        text(o, '[data-cms-count]', () => up(o));
        text(o, '[data-cms-percent]', () => (sum ? Math.round((up(o) / sum) * 100) : 0) + '%');
        o.setAttribute('aria-pressed', String(mine === o.dataset.cmsOption));
        if (right && mine) o.dataset.result = o.dataset.cmsOption === right ? 'correct' : mine === o.dataset.cmsOption ? 'wrong' : '';
      });
      if (mine) el.dataset.voted = mine;
    };
    paint();
    opts.forEach((o) => (o.onclick = async () => {
      const f = o.dataset.cmsOption, prev = read()[key];
      if (prev === f || (prev && el.dataset.cmsChange === undefined)) return;
      try {
        if (prev) n[prev] = await vote(t, prev, 'down'); // switching: the old option loses its vote
        n[f] = await vote(t, f, 'up');
        save(key, f); paint();
      } catch {}
    }));
  });
})();
</script>
```

## Markup recipes

Setup once: create a collection `posts`, add counter fields, publish an entry, then set the project on the page. Field names are slugified, so `opt_a` becomes `opt-a`. Use hyphens from the start.

### Up and down votes

Field `likes` (public counter). Show `up`, `down` or `net`.

```html
<body data-cms-base="https://cms.example.com" data-cms-project="blog" data-cms-collection="posts">
<div data-cms-counter data-cms-entry="hello-world" data-cms-field="likes">
  <button data-cms-vote="up">Up <span data-cms-count="up">0</span></button>
  <button data-cms-vote="down">Down <span data-cms-count="down">0</span></button>
  <span data-cms-count="net">0</span>
</div>
```

The pressed button carries `aria-pressed="true"`, so style it with `[aria-pressed=true]`. A visitor can switch up to down and back on the same post, but cannot vote the same way twice.

### Page views

Field `views` (public counter). Put it on the post page; on list pages use `show` so a listing does not count as a view.

```html
<span data-cms-views>0</span> views
<span data-cms-views="show" data-cms-entry="other-post">0</span>
```

### Poll

One counter field per option on one entry, for example entry `best-editor` with fields `opt-vim`, `opt-vscode`, `opt-zed`. Each option shows its own `up` total and its share of all options.

```html
<div data-cms-poll data-cms-entry="best-editor">
  <button data-cms-option="opt-vim">Vim <i data-cms-count></i> <i data-cms-percent></i></button>
  <button data-cms-option="opt-vscode">VS Code <i data-cms-count></i> <i data-cms-percent></i></button>
  <button data-cms-option="opt-zed">Zed <i data-cms-count></i> <i data-cms-percent></i></button>
</div>
```

By default the first choice is final on that browser. Add `data-cms-change` to let a visitor switch: the script sends `down` for the old option, which moves that vote off its `up` total, then `up` for the new one.

### Quiz

A poll plus `data-cms-correct`. After answering, each option gets `data-result="correct"` or `"wrong"` on the chosen one, and the right one is marked `correct`. Style with `[data-result=correct]`. One entry per question keeps the memory key unique per question, so a visitor can answer every question once.

```html
<div data-cms-poll data-cms-entry="quiz-q1" data-cms-correct="opt-b">
  <button data-cms-option="opt-a">Answer A <i data-cms-percent></i></button>
  <button data-cms-option="opt-b">Answer B <i data-cms-percent></i></button>
</div>
```

The correct answer sits in page HTML, so anyone can read it. This is fine for learning quizzes and engagement, not for graded tests. Scores across questions are yours to add up from `localStorage` (`bcms-votes`) on the page.

### Many posts on one page

Each widget names its own entry with `data-cms-entry`, or inherits it. On a listing, fetch all totals in one call with `GET .../<collection>/counters?slugs=a,b,c` if you render counts server-side or in your own code.

## Working with the API

Every project has its own base URL, `https://<host>/api/v1/<project>`, its own SQLite database and its own API keys. Keys come in two scopes, read and write, and a key can also be allowed to use MCP. The full machine-readable contract is one request away: `GET /api/v1/<project>/openapi.json` (OpenAPI 3.1, any key). Import it into Postman, Insomnia or Swagger UI, or read it as the source of truth.

| Need | Call | Key |
| --- | --- | --- |
| List published entries | `GET /<collection>?limit=50&offset=0&updated_since=<ISO date>` | read |
| One entry | `GET /<collection>/<entry>` | read |
| Schema and field types | `GET /schema`, `GET /field-types` | read |
| Any MCP tool over plain REST | `POST /call/<tool>` with the tool arguments as a JSON body | read for read tools, write for write tools |
| MCP (JSON-RPC 2.0) | `POST /mcp/<project>` | key with MCP access on; write tools also need write scope |
| Create, edit, publish, schedule, delete entries | tools `create_entry`, `update_entry`, `publish_entry` (with `at` to schedule), `unpublish_entry`, `delete_entry`, `batch_create_entries` | write |
| Change the schema | tools `create_collection`, `add_field`, `update_field`, `remove_field`, `apply_schema`, or `POST /schema` | write |
| Files | `POST /media` (multipart) or `upload_media` | write |
| Backup and restore | `GET /export`, `POST /import` | read to export, write to import |
| Counter votes and totals | see The counter field | none for public fields |

Behaviours worth knowing before you build:

- **Drafts are invisible to the API.** Reads return only published entries. Publish with `publish_entry`. A future `at` keeps the entry hidden, including its counters, until that time.
- **Caching is built in.** List and entry responses carry an opaque `ETag`. Send it back as `If-None-Match` and an unchanged project answers `304` with no body. Counter reads are `no-cache`, so totals stay fresh.
- **Rate limits are per project and off for new projects.** The owner can set a write limit per key (covers REST writes, `/call` and `/mcp`) and a vote limit per IP (public counter votes only). Reads and counter totals are never limited. When a limit is on, responses carry `RateLimit-*` headers and a `429` carries `Retry-After`.
- **Webhooks** can notify your build when an entry is published, so a static site can rebuild on change.

### Why it suits agents

- One registry of tools serves both MCP and plain REST, so an agent without MCP support can do everything with `curl`-style calls to `/call/<tool>`.
- `describe_field_types`, `get_schema` and `openapi.json` let an agent learn the shape of a project at runtime instead of guessing.
- No runtime dependencies and no build step: it is a single Node process with one SQLite file per project, so it is cheap to host and easy to back up with `GET /export`.
- It is fast on small hardware. On one CPU the short-list read path served roughly 2,000 to 4,000 requests per second in the project benchmark, and counter votes several thousand per second, because votes are batched in memory and written every 5 seconds.

### Do not assume

- Counter totals are not in entry payloads. Fetch them separately.
- Public counters are soft signals. Do not use them for anything that needs identity or fairness.
- A key shown once at creation is never shown again. Only a hash is stored, so lost keys must be replaced, not recovered.
