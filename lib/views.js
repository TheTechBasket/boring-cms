// Server-rendered HTML, as plain template strings. No framework, no build step.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// Shared shadcn-style class strings. Keep these as the single source of
// truth for each primitive so templates below never hand-roll utilities.

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ' +
  'disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 w-fit cursor-pointer';

const BUTTON_VARIANTS = {
  default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
  destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90',
};

function button({ label, variant = 'default', type = 'submit' }) {
  return `<button type="${type}" class="${BUTTON_BASE} ${BUTTON_VARIANTS[variant]}">${escapeHtml(label)}</button>`;
}

const INPUT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs ' +
  'transition-colors placeholder:text-muted-foreground focus-visible:outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

function field({ label, name, type = 'text', required = false, value, placeholder, autofocus = false, minlength, pattern, autocomplete }) {
  const attrs = [
    `type="${type}"`,
    `name="${name}"`,
    required ? 'required' : '',
    autofocus ? 'autofocus' : '',
    value !== undefined ? `value="${escapeHtml(value)}"` : '',
    placeholder !== undefined ? `placeholder="${escapeHtml(placeholder)}"` : '',
    minlength !== undefined ? `minlength="${minlength}"` : '',
    pattern !== undefined ? `pattern="${pattern}"` : '',
    autocomplete !== undefined ? `autocomplete="${autocomplete}"` : '',
  ].filter(Boolean).join(' ');

  return `<label class="flex flex-col gap-1.5 text-sm">
    <span class="font-medium text-foreground">${escapeHtml(label)}</span>
    <input ${attrs} class="${INPUT_CLASS}">
  </label>`;
}

const CARD_CLASS =
  'rounded-lg border border-border bg-card text-card-foreground shadow-xs p-6 flex flex-col gap-4 max-w-md';

function card({ action, extraClass = '', dataConfirm, children }) {
  const confirmAttr = dataConfirm ? ` data-confirm="${dataConfirm}"` : '';
  return `<form method="post" action="${action}" class="${CARD_CLASS} ${extraClass}"${confirmAttr}>
    ${children}
  </form>`;
}

const NOTICE_VARIANTS = {
  error:
    'border-destructive/50 bg-destructive/10 text-destructive dark:border-destructive dark:bg-destructive/20',
  success:
    'border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400',
};

function notice({ type, message }) {
  const variant = NOTICE_VARIANTS[type] || NOTICE_VARIANTS.error;
  return `<p class="rounded-lg border px-4 py-3 text-sm mb-4 ${variant}">${escapeHtml(message)}</p>`;
}

function layout({ title, body, nav = true, user = null, notice: pageNotice = null }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · yncms</title>
  <link rel="stylesheet" href="/public/admin.css">
</head>
<body class="min-h-screen bg-background text-foreground">
  ${nav ? renderNav(user) : ''}
  <main class="@container mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
    ${pageNotice ? notice({ type: pageNotice.type, message: pageNotice.message }) : ''}
    ${body}
  </main>
  <script src="/public/admin.js"></script>
</body>
</html>`;
}

function renderNav(user) {
  if (!user) return '';
  return `<header class="border-b border-border bg-card">
    <div class="mx-auto max-w-3xl px-6 py-3 flex items-center gap-6">
      <a class="font-bold text-foreground no-underline" href="/admin/projects">yncms</a>
      <nav class="flex gap-4 flex-1">
        <a class="text-foreground no-underline hover:text-primary" href="/admin/projects">Projects</a>
        <a class="text-foreground no-underline hover:text-primary" href="/admin/settings">Settings</a>
      </nav>
      <form method="post" action="/logout" class="flex items-center gap-2">
        <span class="text-sm text-muted-foreground">${escapeHtml(user.email)}</span>
        ${button({ label: 'Log out', variant: 'default' })}
      </form>
    </div>
  </header>`;
}

export function setupPage({ error } = {}) {
  return layout({
    title: 'Set up yncms',
    nav: false,
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

export function loginPage({ error } = {}) {
  return layout({
    title: 'Log in',
    nav: false,
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

export function resetPasswordPage({ error } = {}) {
  return layout({
    title: 'Set a new password',
    nav: false,
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

export function projectListPage({ user, projects, notice: pageNotice }) {
  const rows = projects
    .map(
      (p) => `<tr class="border-b border-border">
        <td class="p-2 text-left">${escapeHtml(p.name)}</td>
        <td class="p-2 text-left"><code class="text-sm">${escapeHtml(p.slug)}</code></td>
        <td class="p-2 text-left @max-lg:hidden">${escapeHtml(p.created_at)}</td>
        <td class="p-2 text-left">
          <a class="text-primary hover:underline" href="/admin/projects/${encodeURIComponent(p.slug)}">Manage</a>
        </td>
      </tr>`,
    )
    .join('\n');

  return layout({
    title: 'Projects',
    user,
    notice: pageNotice,
    body: `
      <h1 class="text-2xl font-semibold">Projects</h1>
      <table class="w-full border-collapse mb-4">
        <thead><tr class="border-b border-border">
          <th class="p-2 text-left font-medium">Name</th>
          <th class="p-2 text-left font-medium">Slug</th>
          <th class="p-2 text-left font-medium @max-lg:hidden">Created</th>
          <th class="p-2 text-left font-medium"></th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="p-2 text-muted-foreground italic">No projects yet.</td></tr>'}</tbody>
      </table>

      <h2 class="text-lg font-semibold mt-4">New project</h2>
      ${card({
        action: '/admin/projects',
        children: `
        ${field({ label: 'Name', name: 'name', required: true, autofocus: true })}
        ${field({ label: 'Slug', name: 'slug', required: true, pattern: '[a-z0-9]([a-z0-9-]*[a-z0-9])?', placeholder: 'my-project' })}
        ${button({ label: 'Create project' })}
      `,
      })}
    `,
  });
}

export function projectDetailPage({ user, project, settingKeys, notice: pageNotice }) {
  const keys = settingKeys
    .map((s) => `<li class="py-1.5 border-b border-border"><code class="text-sm">${escapeHtml(s.key)}</code> <span class="text-muted-foreground text-sm">(updated ${escapeHtml(s.updated_at)})</span></li>`)
    .join('\n');

  return layout({
    title: project.name,
    user,
    notice: pageNotice,
    body: `
      <p><a class="text-primary hover:underline" href="/admin/projects">&larr; All projects</a></p>
      <h1 class="text-2xl font-semibold">${escapeHtml(project.name)}</h1>
      <p class="text-sm text-muted-foreground">Slug: <code>${escapeHtml(project.slug)}</code></p>

      <h2 class="text-lg font-semibold mt-4">Rename</h2>
      ${card({
        action: `/admin/projects/${encodeURIComponent(project.slug)}/rename`,
        children: `
        ${field({ label: 'Name', name: 'name', value: project.name, required: true })}
        ${button({ label: 'Rename' })}
      `,
      })}

      <h2 class="text-lg font-semibold mt-4">Project settings</h2>
      <ul class="list-none p-0">${keys || '<li class="py-1.5 text-muted-foreground italic">No settings set.</li>'}</ul>
      ${card({
        action: `/admin/projects/${encodeURIComponent(project.slug)}/settings`,
        children: `
        ${field({ label: 'Key', name: 'key', required: true })}
        ${field({ label: 'Value', name: 'value', type: 'password', required: true, autocomplete: 'off' })}
        ${button({ label: 'Save setting' })}
      `,
      })}

      <h2 class="text-lg font-semibold mt-4 text-destructive">Delete project</h2>
      <p class="text-sm text-muted-foreground">This permanently deletes the project database file. This cannot be undone.</p>
      ${card({
        action: `/admin/projects/${encodeURIComponent(project.slug)}/delete`,
        extraClass: 'border-destructive/50',
        dataConfirm: 'delete-project',
        children: `
        ${field({ label: 'Type the project slug to confirm', name: 'confirm', required: true, placeholder: project.slug })}
        ${button({ label: 'Delete project', variant: 'destructive' })}
      `,
      })}
    `,
  });
}

export function globalSettingsPage({ user, settingKeys, notice: pageNotice }) {
  const keys = settingKeys
    .map((s) => `<li class="py-1.5 border-b border-border"><code class="text-sm">${escapeHtml(s.key)}</code> <span class="text-muted-foreground text-sm">(updated ${escapeHtml(s.updated_at)})</span></li>`)
    .join('\n');

  return layout({
    title: 'Settings',
    user,
    notice: pageNotice,
    body: `
      <h1 class="text-2xl font-semibold">Global settings</h1>
      <p class="text-sm text-muted-foreground">Values are write-only. Once set, only the key name and last-updated time are shown here, never the value.</p>
      <ul class="list-none p-0">${keys || '<li class="py-1.5 text-muted-foreground italic">No settings set.</li>'}</ul>
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

export function errorPage({ status, message }) {
  return layout({
    title: `Error ${status}`,
    nav: false,
    body: `<h1 class="text-2xl font-semibold">${status}</h1><p class="text-sm text-muted-foreground">${escapeHtml(message)}</p>`,
  });
}
