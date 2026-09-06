// Server-rendered HTML, as plain template strings. No framework, no build step.

import { entryLabel } from './content.ts';

function escapeHtml(str: unknown): string {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] as string));
}

// Shared shadcn-style class strings. Keep these as the single source of
// truth for each primitive so templates below never hand-roll utilities.

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ' +
  'disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 w-fit cursor-pointer';

const BUTTON_VARIANTS: Record<string, string> = {
  default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
  destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90',
  outline: 'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
};

function button({ label, variant = 'default', type = 'submit', small = false, name, value }: {
  label: string; variant?: string; type?: string; small?: boolean; name?: string; value?: string;
}): string {
  const size = small ? 'h-7 px-2.5 text-xs' : '';
  const extra = (name ? ` name="${name}"` : '') + (value !== undefined ? ` value="${escapeHtml(value)}"` : '');
  return `<button type="${type}"${extra} class="${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${size}">${escapeHtml(label)}</button>`;
}

const INPUT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs ' +
  'transition-colors placeholder:text-muted-foreground focus-visible:outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const TEXTAREA_CLASS = INPUT_CLASS.replace('h-9', 'min-h-40 py-2 font-mono leading-relaxed');

const SELECT_CLASS =
  'flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer';

function field({ label, name, type = 'text', required = false, value, placeholder, autofocus = false, minlength, autocomplete }: {
  label: string; name: string; type?: string; required?: boolean; value?: string;
  placeholder?: string; autofocus?: boolean; minlength?: number; autocomplete?: string;
}): string {
  const attrs = [
    `type="${type}"`,
    `name="${name}"`,
    required ? 'required' : '',
    autofocus ? 'autofocus' : '',
    value !== undefined ? `value="${escapeHtml(value)}"` : '',
    placeholder !== undefined ? `placeholder="${escapeHtml(placeholder)}"` : '',
    minlength !== undefined ? `minlength="${minlength}"` : '',
    autocomplete !== undefined ? `autocomplete="${autocomplete}"` : '',
  ].filter(Boolean).join(' ');

  return `<label class="flex flex-col gap-1.5 text-sm">
    <span class="font-medium text-foreground">${escapeHtml(label)}</span>
    <input ${attrs} class="${INPUT_CLASS}">
  </label>`;
}

const CARD_CLASS =
  'rounded-lg border border-border bg-card text-card-foreground shadow-xs p-6 flex flex-col gap-4';

function card({ action, extraClass = 'max-w-md', dataConfirm, children }: {
  action: string; extraClass?: string; dataConfirm?: string; children: string;
}): string {
  const confirmAttr = dataConfirm ? ` data-confirm="${dataConfirm}"` : '';
  return `<form method="post" action="${action}" class="${CARD_CLASS} ${extraClass}"${confirmAttr}>
    ${children}
  </form>`;
}

const NOTICE_VARIANTS: Record<string, string> = {
  error:
    'border-destructive/50 bg-destructive/10 text-destructive dark:border-destructive dark:bg-destructive/20',
  success:
    'border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400',
};

function notice({ type, message }: { type: string; message: string }): string {
  const variant = NOTICE_VARIANTS[type] || NOTICE_VARIANTS.error;
  return `<p class="rounded-lg border px-4 py-3 text-sm ${variant}">${escapeHtml(message)}</p>`;
}

function sectionHeading(text: string): string {
  return `<h2 class="text-lg font-semibold mt-2">${escapeHtml(text)}</h2>`;
}

// Destructive actions live collapsed behind a <details>, not always on screen.
function dangerDetails({ summary, description, children }: { summary: string; description: string; children: string }): string {
  return `<details class="mt-6 max-w-md">
    <summary class="cursor-pointer text-sm font-medium text-destructive select-none">${escapeHtml(summary)}</summary>
    <div class="mt-3 flex flex-col gap-3">
      <p class="text-sm text-muted-foreground">${escapeHtml(description)}</p>
      ${children}
    </div>
  </details>`;
}

// A "+" button in the page header that opens a small popover form. All
// create actions use this instead of always-visible forms.
function addPopover({ label, action, children }: { label: string; action: string; children: string }): string {
  return `<details class="relative" data-popover>
    <summary class="${BUTTON_BASE} ${BUTTON_VARIANTS.default} list-none select-none [&::-webkit-details-marker]:hidden">+ ${escapeHtml(label)}</summary>
    <div class="absolute right-0 top-full mt-2 z-10 w-80 border border-border bg-popover text-popover-foreground shadow-lg p-5">
      <form method="post" action="${action}" class="flex flex-col gap-4">${children}</form>
    </div>
  </details>`;
}

function pageHeader(title: string, right = ''): string {
  return `<div class="flex items-center justify-between gap-4 flex-wrap">
    <h1 class="text-2xl font-semibold">${escapeHtml(title)}</h1>
    <div class="flex items-center gap-2">${right}</div>
  </div>`;
}

// Tables sit on a card surface instead of floating on the page background.
function tableCard(children: string): string {
  return `<div class="border border-border bg-card shadow-xs overflow-x-auto">${children}</div>`;
}

const STAT_TONES: Record<string, string> = {
  lavender: 'bg-primary text-primary-foreground',
  black: 'bg-foreground text-background',
  white: 'bg-card text-card-foreground border border-border',
};

function statCard({ label, value, tone = 'white' }: { label: string; value: number | string; tone?: string }): string {
  return `<div class="${STAT_TONES[tone]} p-5 flex flex-col gap-5 shadow-xs">
    <span class="text-xs font-medium uppercase tracking-wide opacity-70">${escapeHtml(label)}</span>
    <span class="text-3xl font-semibold tracking-tight">${escapeHtml(value)}</span>
  </div>`;
}

// ---- Layout with sidebar ------------------------------------------------

type LayoutOpts = {
  title: string;
  body: string;
  user?: { email: string } | null;
  projects?: { slug: string; name: string }[];
  project?: { slug: string; name: string } | null;
  notice?: { type: string; message: string } | null;
  bare?: boolean; // auth pages: no sidebar
};

function layout({ title, body, user = null, projects = [], project = null, notice: pageNotice = null, bare = false }: LayoutOpts): string {
  const shell = bare
    ? `<main class="mx-auto max-w-md px-6 py-16 flex flex-col gap-6">
        ${pageNotice ? notice(pageNotice) : ''}
        ${body}
      </main>`
    : `<div class="flex min-h-screen">
        ${sidebar({ user: user!, projects, project })}
        <main class="@container flex-1 min-w-0 px-8 py-8 flex flex-col gap-5">
          ${pageNotice ? notice(pageNotice) : ''}
          ${body}
        </main>
      </div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · yncms</title>
  <link rel="stylesheet" href="/public/admin.css">
</head>
<body class="min-h-screen bg-background text-foreground">
  ${shell}
  <script type="module">import { marked } from '/public/vendor/marked.esm.js'; window.marked = marked;</script>
  <script src="/public/admin.js"></script>
</body>
</html>`;
}

const SIDEBAR_LINK = 'block rounded-md px-3 py-1.5 text-sm text-sidebar-foreground no-underline hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';

function sidebar({ user, projects, project }: {
  user: { email: string }; projects: { slug: string; name: string }[]; project: { slug: string; name: string } | null;
}): string {
  const options = [
    `<option value="">Projects overview</option>`,
    ...projects.map(
      (p) =>
        `<option value="${escapeHtml(p.slug)}"${project && p.slug === project.slug ? ' selected' : ''}>${escapeHtml(p.name)}</option>`,
    ),
  ].join('');

  const projectNav = project
    ? `<div class="flex flex-col gap-0.5 mt-4">
        <span class="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">${escapeHtml(project.name)}</span>
        <a class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/collections">Content</a>
        <a class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/media">Media</a>
        <a class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/api-keys">API keys</a>
        <a class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}">Project settings</a>
      </div>`
    : '';

  return `<aside class="w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col p-3 sticky top-0 h-screen">
    <a class="px-3 py-2 font-bold text-sidebar-foreground no-underline" href="/admin/projects">yncms</a>
    <select id="project-switcher" class="${SELECT_CLASS} bg-sidebar mb-1" title="Switch project">${options}</select>
    ${projectNav}
    <div class="mt-auto flex flex-col gap-0.5 border-t border-sidebar-border pt-3">
      <span class="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Instance</span>
      <a class="${SIDEBAR_LINK}" href="/admin/projects">Projects</a>
      <a class="${SIDEBAR_LINK}" href="/admin/settings">Global settings</a>
      <div class="mt-2 border-t border-sidebar-border pt-3 px-3 flex flex-col gap-2">
        <span class="text-xs text-muted-foreground truncate">${escapeHtml(user.email)}</span>
        <form method="post" action="/logout">${button({ label: 'Log out', variant: 'outline', small: true })}</form>
      </div>
    </div>
  </aside>`;
}

// ---- Auth pages -----------------------------------------------------------

export function setupPage({ error }: { error?: string } = {}): string {
  return layout({
    title: 'Set up yncms',
    bare: true,
    body: `
      <h1 class="text-2xl font-semibold">Set up yncms</h1>
      <p class="text-sm text-muted-foreground">No admin account exists yet. Create the one and only admin user.</p>
      ${error ? notice({ type: 'error', message: error }) : ''}
      ${card({
        action: '/setup',
        children: `
        ${field({ label: 'Email', name: 'email', type: 'email', required: true, autofocus: true })}
        ${field({ label: 'Password', name: 'password', type: 'password', required: true, minlength: 8 })}
        ${field({ label: 'Confirm password', name: 'password_confirm', type: 'password', required: true, minlength: 8 })}
        ${button({ label: 'Create admin account' })}
      `,
      })}
    `,
  });
}

export function loginPage({ error }: { error?: string } = {}): string {
  return layout({
    title: 'Log in',
    bare: true,
    body: `
      <h1 class="text-2xl font-semibold">Log in</h1>
      ${error ? notice({ type: 'error', message: error }) : ''}
      ${card({
        action: '/login',
        children: `
        ${field({ label: 'Email', name: 'email', type: 'email', required: true, autofocus: true })}
        ${field({ label: 'Password', name: 'password', type: 'password', required: true })}
        ${button({ label: 'Log in' })}
      `,
      })}
    `,
  });
}

export function resetPasswordPage({ error }: { error?: string } = {}): string {
  return layout({
    title: 'Set a new password',
    bare: true,
    body: `
      <h1 class="text-2xl font-semibold">Set a new password</h1>
      <p class="text-sm text-muted-foreground">A password reset was requested for this account. Choose a new password to continue.</p>
      ${error ? notice({ type: 'error', message: error }) : ''}
      ${card({
        action: '/reset-password',
        children: `
        ${field({ label: 'New password', name: 'password', type: 'password', required: true, minlength: 8 })}
        ${field({ label: 'Confirm new password', name: 'password_confirm', type: 'password', required: true, minlength: 8 })}
        ${button({ label: 'Set password' })}
      `,
      })}
    `,
  });
}

// ---- Projects -------------------------------------------------------------

export function projectListPage({ user, projects, notice: pageNotice }: any): string {
  const rows = projects
    .map(
      (p: any) => `<tr class="border-b border-border">
        <td class="p-3 text-left"><a class="text-foreground font-medium no-underline hover:text-primary" href="/admin/projects/${encodeURIComponent(p.slug)}/collections">${escapeHtml(p.name)}</a></td>
        <td class="p-3 text-left"><code class="text-sm text-muted-foreground">${escapeHtml(p.slug)}</code></td>
        <td class="p-3 text-left @max-lg:hidden text-sm text-muted-foreground">${escapeHtml(p.created_at)}</td>
        <td class="p-3 text-right">
          <a class="text-primary text-sm hover:underline" href="/admin/projects/${encodeURIComponent(p.slug)}">Settings</a>
        </td>
      </tr>`,
    )
    .join('\n');

  return layout({
    title: 'Projects',
    user,
    projects,
    notice: pageNotice,
    body: `
      ${pageHeader('Projects', addPopover({
        label: 'New project',
        action: '/admin/projects',
        children: `
        ${field({ label: 'Name', name: 'name', required: true, placeholder: 'My Blog' })}
        <p class="text-xs text-muted-foreground">The URL slug is generated automatically.</p>
        ${button({ label: 'Create project' })}
      `,
      }))}
      ${tableCard(`<table class="w-full border-collapse">
        <thead><tr class="border-b border-border">
          <th class="p-3 text-left font-medium">Name</th>
          <th class="p-3 text-left font-medium">Slug</th>
          <th class="p-3 text-left font-medium @max-lg:hidden">Created</th>
          <th class="p-3"></th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="p-3 text-muted-foreground italic">No projects yet.</td></tr>'}</tbody>
      </table>`)}
    `,
  });
}

export function projectDetailPage({ user, projects, project, settingKeys, notice: pageNotice }: any): string {
  const keys = settingKeys
    .map((s: any) => `<li class="py-1.5 border-b border-border"><code class="text-sm">${escapeHtml(s.key)}</code> <span class="text-muted-foreground text-sm">(updated ${escapeHtml(s.updated_at)})</span></li>`)
    .join('\n');

  return layout({
    title: project.name,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      <h1 class="text-2xl font-semibold">${escapeHtml(project.name)}</h1>
      <p class="text-sm text-muted-foreground">Slug: <code>${escapeHtml(project.slug)}</code> · API base: <code>/api/v1/${escapeHtml(project.slug)}/</code></p>

      <div class="grid gap-6 @3xl:grid-cols-2">
        <div class="flex flex-col gap-4">
          ${sectionHeading('Rename')}
          ${card({
            action: `/admin/projects/${encodeURIComponent(project.slug)}/rename`,
            extraClass: '',
            children: `
            ${field({ label: 'Name', name: 'name', value: project.name, required: true })}
            ${button({ label: 'Rename' })}
          `,
          })}

          ${sectionHeading('Project settings')}
          <p class="text-sm text-muted-foreground">Values are write-only and stored encrypted. Only key names are shown.</p>
          <ul class="list-none p-0">${keys || '<li class="py-1.5 text-muted-foreground italic">No settings set.</li>'}</ul>
          ${card({
            action: `/admin/projects/${encodeURIComponent(project.slug)}/settings`,
            extraClass: '',
            children: `
            ${field({ label: 'Key', name: 'key', required: true })}
            ${field({ label: 'Value', name: 'value', type: 'password', required: true, autocomplete: 'off' })}
            ${button({ label: 'Save setting' })}
          `,
          })}
        </div>

      </div>

      ${dangerDetails({
        summary: 'Delete project',
        description: 'This permanently deletes the project database file. This cannot be undone.',
        children: card({
          action: `/admin/projects/${encodeURIComponent(project.slug)}/delete`,
          extraClass: 'border-destructive/50',
          dataConfirm: 'delete-project',
          children: `
          ${field({ label: 'Type the project slug to confirm', name: 'confirm', required: true, placeholder: project.slug })}
          ${button({ label: 'Delete project', variant: 'destructive' })}
        `,
        }),
      })}
    `,
  });
}

export function globalSettingsPage({ user, projects, settingKeys, notice: pageNotice }: any): string {
  const keys = settingKeys
    .map((s: any) => `<li class="py-1.5 border-b border-border"><code class="text-sm">${escapeHtml(s.key)}</code> <span class="text-muted-foreground text-sm">(updated ${escapeHtml(s.updated_at)})</span></li>`)
    .join('\n');

  return layout({
    title: 'Settings',
    user,
    projects,
    notice: pageNotice,
    body: `
      <h1 class="text-2xl font-semibold">Global settings</h1>
      <p class="text-sm text-muted-foreground">Values are write-only. Once set, only the key name and last-updated time are shown here, never the value.</p>
      <ul class="list-none p-0 max-w-2xl">${keys || '<li class="py-1.5 text-muted-foreground italic">No settings set.</li>'}</ul>
      ${card({
        action: '/admin/settings',
        children: `
        ${field({ label: 'Key', name: 'key', required: true })}
        ${field({ label: 'Value', name: 'value', type: 'password', required: true, autocomplete: 'off' })}
        ${button({ label: 'Save setting' })}
      `,
      })}
    `,
  });
}

// ---- Collections ----------------------------------------------------------

export function collectionsPage({ user, projects, project, collections, stats, notice: pageNotice }: any): string {
  const rows = collections
    .map(
      (c: any) => `<tr class="border-b border-border">
        <td class="p-3"><a class="text-foreground font-medium no-underline hover:text-primary" href="/admin/projects/${project.slug}/collections/${c.slug}">${escapeHtml(c.name)}</a></td>
        <td class="p-3"><code class="text-sm text-muted-foreground">${escapeHtml(c.slug)}</code></td>
        <td class="p-3 text-sm text-muted-foreground">${c.fields.length} field${c.fields.length === 1 ? '' : 's'}</td>
      </tr>`,
    )
    .join('\n');

  const statsRow = stats
    ? `<div class="grid gap-4 @2xl:grid-cols-2 @4xl:grid-cols-4">
        ${statCard({ label: 'Collections', value: collections.length, tone: 'white' })}
        ${statCard({ label: 'Entries', value: stats.entries, tone: 'lavender' })}
        ${statCard({ label: 'Published', value: stats.published, tone: 'black' })}
        ${statCard({ label: 'API keys', value: stats.apiKeys, tone: 'white' })}
      </div>`
    : '';

  return layout({
    title: `Content · ${project.name}`,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      ${pageHeader('Content', addPopover({
        label: 'New collection',
        action: `/admin/projects/${project.slug}/collections`,
        children: `
        ${field({ label: 'Name', name: 'name', required: true, placeholder: 'Posts' })}
        ${button({ label: 'Create collection' })}
      `,
      }))}
      ${statsRow}
      ${tableCard(`<table class="w-full border-collapse">
        <thead><tr class="border-b border-border">
          <th class="p-3 text-left font-medium">Collection</th>
          <th class="p-3 text-left font-medium">Slug</th>
          <th class="p-3 text-left font-medium">Fields</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="p-3 text-muted-foreground italic">No collections yet. Create one with the + button, for example Posts or Pages.</td></tr>'}</tbody>
      </table>`)}
    `,
  });
}

export function collectionPage({ user, projects, project, collection, entries, fieldTypes, notice: pageNotice }: any): string {
  const base = `/admin/projects/${project.slug}/collections/${collection.slug}`;

  const gripIcon = `<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>`;

  const fieldRows = collection.fields
    .map(
      (f: any) => `<div draggable="true" data-field="${escapeHtml(f.name)}" class="flex items-center gap-3 border-b border-border px-3 py-2 text-sm cursor-grab bg-card">
        <span class="text-muted-foreground shrink-0" aria-hidden="true">${gripIcon}</span>
        <span class="font-medium">${escapeHtml(f.label)}</span>
        <code class="text-muted-foreground">${escapeHtml(f.name)}</code>
        <span class="text-muted-foreground">${escapeHtml(f.type)}</span>
        <form method="post" action="${base}/fields/remove" class="ml-auto">
          <input type="hidden" name="field" value="${escapeHtml(f.name)}">
          ${button({ label: 'Remove', variant: 'ghost', small: true })}
        </form>
      </div>`,
    )
    .join('\n');

  const initialOrder = collection.fields.map((f: any) => f.name).join(',');

  const entryRows = entries
    .map(
      (e: any) => `<tr class="border-b border-border">
        <td class="p-3"><a class="text-foreground font-medium no-underline hover:text-primary" href="${base}/${e.slug}">${escapeHtml(entryLabel(e, collection))}</a></td>
        <td class="p-3">${statusBadge(e.status)}</td>
        <td class="p-3 text-sm text-muted-foreground @max-lg:hidden">${escapeHtml(e.updated_at)}</td>
      </tr>`,
    )
    .join('\n');

  const typeOptions = fieldTypes.map((t: string) => `<option value="${t}">${t}</option>`).join('');

  return layout({
    title: `${collection.name} · ${project.name}`,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      ${pageHeader(collection.name, `<a href="${base}/new" class="${BUTTON_BASE} ${BUTTON_VARIANTS.default} no-underline">+ New entry</a>`)}

      ${tableCard(`<table class="w-full border-collapse">
        <thead><tr class="border-b border-border">
          <th class="p-3 text-left font-medium">Entry</th>
          <th class="p-3 text-left font-medium">Status</th>
          <th class="p-3 text-left font-medium @max-lg:hidden">Updated</th>
        </tr></thead>
        <tbody>${entryRows || '<tr><td colspan="3" class="p-3 text-muted-foreground italic">No entries yet.</td></tr>'}</tbody>
      </table>`)}

      <div class="flex flex-col gap-3 mt-16 max-w-2xl">
        <div class="flex items-center justify-between gap-4">
          ${sectionHeading('Fields')}
          ${addPopover({
            label: 'Add field',
            action: `${base}/fields/add`,
            children: `
            ${field({ label: 'Field label', name: 'label', required: true, placeholder: 'Body' })}
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium text-foreground">Type</span>
              <select name="type" class="${SELECT_CLASS}">${typeOptions}</select>
            </label>
            ${button({ label: 'Add field' })}
          `,
          })}
        </div>
        <p class="text-sm text-muted-foreground">Drag to reorder. The first field's value is the entry label in lists; entries with no values show their id.</p>
        <div class="border border-border bg-card shadow-xs" data-field-list>
          ${fieldRows || '<p class="p-3 text-muted-foreground italic text-sm m-0">No fields yet. Add a markdown body or more with the + button.</p>'}
          <form method="post" action="${base}/fields/reorder" data-reorder-form data-initial="${escapeHtml(initialOrder)}" hidden>
            <input type="hidden" name="order" value="">
          </form>
        </div>
      </div>

      ${dangerDetails({
        summary: 'Delete collection',
        description: 'Deletes this collection and every entry in it.',
        children: card({
          action: `${base}/delete`,
          extraClass: 'border-destructive/50',
          dataConfirm: 'delete-collection',
          children: `
          ${field({ label: 'Type the collection slug to confirm', name: 'confirm', required: true, placeholder: collection.slug })}
          ${button({ label: 'Delete collection', variant: 'destructive' })}
        `,
        }),
      })}
    `,
  });
}

function statusBadge(status: string): string {
  const cls =
    status === 'published'
      ? 'bg-accent text-accent-foreground border-transparent'
      : 'bg-muted text-muted-foreground border-border';
  return `<span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}">${escapeHtml(status)}</span>`;
}

// ---- Entry editor ---------------------------------------------------------

function fieldInput(f: { name: string; label: string; type: string }, value: unknown): string {
  const v = value ?? '';
  switch (f.type) {
    case 'markdown':
      return `<div class="flex flex-col gap-1.5 text-sm" data-markdown-field>
        <div class="flex items-center justify-between">
          <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
          <button type="button" data-preview-toggle class="text-xs text-primary hover:underline cursor-pointer bg-transparent border-0 p-0">Preview</button>
        </div>
        <textarea name="field_${f.name}" class="${TEXTAREA_CLASS}" rows="14">${escapeHtml(v)}</textarea>
        <div data-preview class="typeset rounded-md border border-border bg-card p-4 hidden"></div>
      </div>`;
    case 'boolean':
      return `<label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="field_${f.name}" value="1"${v ? ' checked' : ''} class="size-4 accent-primary">
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
      </label>`;
    case 'json': {
      const raw = typeof v === 'string' ? v : v === '' ? '' : JSON.stringify(v, null, 2);
      return `<label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        <textarea name="field_${f.name}" class="${TEXTAREA_CLASS}" rows="10" placeholder="{ }" spellcheck="false">${escapeHtml(raw)}</textarea>
      </label>`;
    }
    case 'number':
      return field({ label: f.label, name: `field_${f.name}`, type: 'number', value: String(v) });
    case 'date':
      return field({ label: f.label, name: `field_${f.name}`, type: 'date', value: String(v) });
    default:
      return field({ label: f.label, name: `field_${f.name}`, value: String(v) });
  }
}

export function entryEditorPage({ user, projects, project, collection, entry, revisions = [], notice: pageNotice }: any): string {
  const base = `/admin/projects/${project.slug}/collections/${collection.slug}`;
  const isNew = !entry;
  const action = isNew ? `${base}/new` : `${base}/${entry.slug}`;
  const data = entry?.data ?? {};

  const fieldInputs = collection.fields.map((f: any) => fieldInput(f, data[f.name])).join('\n');

  const revisionRows = revisions
    .map((r: any) => {
      const fields = Object.keys(r.changed).map((k) => (k === '__title' ? 'title' : k)).join(', ');
      return `<li class="flex items-center justify-between gap-2 py-1.5 border-b border-border text-sm">
        <span class="text-muted-foreground min-w-0 truncate">${escapeHtml(r.created_at)} · changed: ${escapeHtml(fields)}</span>
        <form method="post" action="${base}/${entry.slug}/revert" class="shrink-0">
          <input type="hidden" name="revision_id" value="${r.id}">
          ${button({ label: 'Revert', variant: 'outline', small: true })}
        </form>
      </li>`;
    })
    .join('\n');

  const sidePanel = isNew
    ? ''
    : `<div class="flex flex-col gap-4">
        <div class="${CARD_CLASS}">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">Status</span>
            ${statusBadge(entry.status)}
          </div>
          <p class="text-xs text-muted-foreground">Slug: <code>${escapeHtml(entry.slug)}</code><br>Updated: ${escapeHtml(entry.updated_at)}${entry.published_at ? `<br>Published: ${escapeHtml(entry.published_at)}` : ''}</p>
          <div class="flex gap-2 flex-wrap">
            ${entry.status === 'published'
              ? `<form method="post" action="${base}/${entry.slug}/unpublish">${button({ label: 'Unpublish', variant: 'outline' })}</form>`
              : `<form method="post" action="${base}/${entry.slug}/publish">${button({ label: 'Publish' })}</form>`}
            <form method="post" action="${base}/${entry.slug}/delete" data-confirm="delete-entry">${button({ label: 'Delete', variant: 'destructive' })}</form>
          </div>
        </div>
        <div class="${CARD_CLASS}">
          <span class="text-sm font-medium">Revisions</span>
          <ul class="list-none p-0 m-0">${revisionRows || '<li class="py-1 text-sm text-muted-foreground italic">No revisions yet. Edits create field-level revisions automatically.</li>'}</ul>
        </div>
      </div>`;

  return layout({
    title: `${isNew ? 'New entry' : entryLabel(entry, collection)} · ${project.name}`,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      <p class="text-sm"><a class="text-primary hover:underline" href="${base}">&larr; ${escapeHtml(collection.name)}</a></p>
      <div class="grid gap-8 @4xl:grid-cols-[minmax(0,1fr)_320px] items-start">
        <form method="post" action="${action}" class="flex flex-col gap-5 min-w-0">
          ${fieldInputs || '<p class="text-sm text-muted-foreground">This collection has no fields yet. Add fields on the collection page.</p>'}
          ${button({ label: isNew ? 'Create entry' : 'Save changes' })}
        </form>
        ${sidePanel}
      </div>
    `,
  });
}

// ---- API keys -------------------------------------------------------------

export function apiKeysPage({ user, projects, project, keys, createdKey, notice: pageNotice }: any): string {
  const rows = keys
    .map(
      (k: any) => `<tr class="border-b border-border">
        <td class="p-2 text-sm">${escapeHtml(k.name)}</td>
        <td class="p-2 text-sm text-muted-foreground">${escapeHtml(k.created_at)}</td>
        <td class="p-2 text-sm text-muted-foreground">${k.last_used_at ? escapeHtml(k.last_used_at) : 'never'}</td>
        <td class="p-2 text-right">
          <form method="post" action="/admin/projects/${project.slug}/api-keys/${k.id}/revoke">
            ${button({ label: 'Revoke', variant: 'ghost', small: true })}
          </form>
        </td>
      </tr>`,
    )
    .join('\n');

  const createdBlock = createdKey
    ? `<div class="rounded-lg border border-emerald-600/30 bg-emerald-50 dark:bg-emerald-950/40 p-4 flex flex-col gap-2">
        <p class="text-sm font-medium text-emerald-700 dark:text-emerald-400">Key created. Copy it now, it will not be shown again.</p>
        <code class="text-sm break-all select-all">${escapeHtml(createdKey)}</code>
      </div>`
    : '';

  return layout({
    title: `API keys · ${project.name}`,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      ${pageHeader('API keys', addPopover({
        label: 'New key',
        action: `/admin/projects/${project.slug}/api-keys`,
        children: `
        ${field({ label: 'Name', name: 'name', required: true, placeholder: 'astro-build' })}
        ${button({ label: 'Create key' })}
      `,
      }))}
      <p class="text-sm text-muted-foreground">Send as <code>Authorization: Bearer &lt;key&gt;</code>. Read-only access to published content at <code>/api/v1/${escapeHtml(project.slug)}/&lt;collection&gt;</code>.</p>
      ${createdBlock}
      ${tableCard(`<table class="w-full border-collapse">
        <thead><tr class="border-b border-border">
          <th class="p-3 text-left font-medium">Name</th>
          <th class="p-3 text-left font-medium">Created</th>
          <th class="p-3 text-left font-medium">Last used</th>
          <th class="p-3"></th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="p-3 text-muted-foreground italic">No API keys yet.</td></tr>'}</tbody>
      </table>`)}
    `,
  });
}

// ---- Media library --------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function mediaPage({ user, projects, project, media, notice: pageNotice }: any): string {
  const cards = media
    .map((m: any) => {
      const url = `/media/${project.slug}/${m.key}`;
      const thumbUrl = m.variants.thumb ? `/media/${project.slug}/${m.variants.thumb}` : url;
      const isImage = m.mime.startsWith('image/');
      const snippet = isImage ? `![${m.filename}](${url})` : `[${m.filename}](${url})`;
      const preview = isImage
        ? `<img src="${thumbUrl}" alt="${escapeHtml(m.filename)}" loading="lazy" class="h-36 w-full object-cover bg-muted">`
        : `<div class="h-36 w-full bg-muted flex items-center justify-center text-xs font-medium uppercase tracking-wide text-muted-foreground">${escapeHtml(m.mime)}</div>`;
      return `<div class="border border-border bg-card shadow-xs flex flex-col">
        <a href="${url}" target="_blank" rel="noopener">${preview}</a>
        <div class="p-3 flex flex-col gap-2 text-sm">
          <span class="font-medium truncate" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</span>
          <span class="text-xs text-muted-foreground">${formatSize(m.size)}${m.width ? ` · ${m.width}×${m.height}` : ''}</span>
          <div class="flex items-center gap-2">
            <button type="button" data-copy="${escapeHtml(snippet)}" class="${BUTTON_BASE} ${BUTTON_VARIANTS.outline} h-7 px-2.5 text-xs">Copy MD</button>
            <form method="post" action="/admin/projects/${project.slug}/media/${m.id}/delete" data-confirm="delete-media">
              ${button({ label: 'Delete', variant: 'ghost', small: true })}
            </form>
          </div>
        </div>
      </div>`;
    })
    .join('\n');

  return layout({
    title: `Media · ${project.name}`,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      ${pageHeader('Media', `<details class="relative" data-popover>
        <summary class="${BUTTON_BASE} ${BUTTON_VARIANTS.default} list-none select-none [&::-webkit-details-marker]:hidden">+ Upload</summary>
        <div class="absolute right-0 top-full mt-2 z-10 w-80 border border-border bg-popover text-popover-foreground shadow-lg p-5">
          <form method="post" action="/admin/projects/${project.slug}/media" enctype="multipart/form-data" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium text-foreground">File (50 MB max)</span>
              <input type="file" name="file" required class="text-sm file:mr-3 file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:cursor-pointer">
            </label>
            ${button({ label: 'Upload' })}
          </form>
        </div>
      </details>`)}
      <p class="text-sm text-muted-foreground">Copy MD copies a markdown snippet to paste into any markdown field. Files are served at <code>/media/${escapeHtml(project.slug)}/&lt;key&gt;</code> with immutable caching.</p>
      ${media.length
        ? `<div class="grid gap-4 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">${cards}</div>`
        : '<p class="text-sm text-muted-foreground italic">No media yet. Upload with the + button.</p>'}
    `,
  });
}

export function errorPage({ status, message }: { status: number; message: string }): string {
  return layout({
    title: `Error ${status}`,
    bare: true,
    body: `<h1 class="text-2xl font-semibold">${status}</h1><p class="text-sm text-muted-foreground">${escapeHtml(message)}</p>`,
  });
}
