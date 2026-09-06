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

function layout({ title, body, nav = true, user = null, notice = null }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · yncms</title>
  <link rel="stylesheet" href="/public/admin.css">
</head>
<body>
  ${nav ? renderNav(user) : ''}
  <main class="container">
    ${notice ? `<p class="notice notice-${notice.type}">${escapeHtml(notice.message)}</p>` : ''}
    ${body}
  </main>
  <script src="/public/admin.js"></script>
</body>
</html>`;
}

function renderNav(user) {
  if (!user) return '';
  return `<header class="topbar">
    <div class="container topbar-inner">
      <a class="brand" href="/admin/projects">yncms</a>
      <nav>
        <a href="/admin/projects">Projects</a>
        <a href="/admin/settings">Settings</a>
      </nav>
      <form method="post" action="/logout" class="logout-form">
        <span class="who">${escapeHtml(user.email)}</span>
        <button type="submit">Log out</button>
      </form>
    </div>
  </header>`;
}

export function setupPage({ error } = {}) {
  return layout({
    title: 'Set up yncms',
    nav: false,
    body: `
      <h1>Set up yncms</h1>
      <p>No admin account exists yet. Create the one and only admin user.</p>
      ${error ? `<p class="notice notice-error">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="/setup" class="card">
        <label>Email
          <input type="email" name="email" required autofocus>
        </label>
        <label>Password
          <input type="password" name="password" required minlength="8">
        </label>
        <label>Confirm password
          <input type="password" name="password_confirm" required minlength="8">
        </label>
        <button type="submit">Create admin account</button>
      </form>
    `,
  });
}

export function loginPage({ error } = {}) {
  return layout({
    title: 'Log in',
    nav: false,
    body: `
      <h1>Log in</h1>
      ${error ? `<p class="notice notice-error">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="/login" class="card">
        <label>Email
          <input type="email" name="email" required autofocus>
        </label>
        <label>Password
          <input type="password" name="password" required>
        </label>
        <button type="submit">Log in</button>
      </form>
    `,
  });
}

export function resetPasswordPage({ error } = {}) {
  return layout({
    title: 'Set a new password',
    nav: false,
    body: `
      <h1>Set a new password</h1>
      <p>A password reset was requested for this account. Choose a new password to continue.</p>
      ${error ? `<p class="notice notice-error">${escapeHtml(error)}</p>` : ''}
      <form method="post" action="/reset-password" class="card">
        <label>New password
          <input type="password" name="password" required minlength="8">
        </label>
        <label>Confirm new password
          <input type="password" name="password_confirm" required minlength="8">
        </label>
        <button type="submit">Set password</button>
      </form>
    `,
  });
}

export function projectListPage({ user, projects, notice }) {
  const rows = projects
    .map(
      (p) => `<tr>
        <td>${escapeHtml(p.name)}</td>
        <td><code>${escapeHtml(p.slug)}</code></td>
        <td>${escapeHtml(p.created_at)}</td>
        <td class="actions">
          <a href="/admin/projects/${encodeURIComponent(p.slug)}">Manage</a>
        </td>
      </tr>`,
    )
    .join('\n');

  return layout({
    title: 'Projects',
    user,
    notice,
    body: `
      <h1>Projects</h1>
      <table class="list">
        <thead><tr><th>Name</th><th>Slug</th><th>Created</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="empty">No projects yet.</td></tr>'}</tbody>
      </table>

      <h2>New project</h2>
      <form method="post" action="/admin/projects" class="card">
        <label>Name
          <input type="text" name="name" required autofocus>
        </label>
        <label>Slug
          <input type="text" name="slug" required pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?" placeholder="my-project">
        </label>
        <button type="submit">Create project</button>
      </form>
    `,
  });
}

export function projectDetailPage({ user, project, settingKeys, notice }) {
  const keys = settingKeys.map((s) => `<li><code>${escapeHtml(s.key)}</code> <span class="muted">(updated ${escapeHtml(s.updated_at)})</span></li>`).join('\n');

  return layout({
    title: project.name,
    user,
    notice,
    body: `
      <p><a href="/admin/projects">&larr; All projects</a></p>
      <h1>${escapeHtml(project.name)}</h1>
      <p class="muted">Slug: <code>${escapeHtml(project.slug)}</code></p>

      <h2>Rename</h2>
      <form method="post" action="/admin/projects/${encodeURIComponent(project.slug)}/rename" class="card">
        <label>Name
          <input type="text" name="name" value="${escapeHtml(project.name)}" required>
        </label>
        <button type="submit">Rename</button>
      </form>

      <h2>Project settings</h2>
      <ul class="setting-list">${keys || '<li class="empty">No settings set.</li>'}</ul>
      <form method="post" action="/admin/projects/${encodeURIComponent(project.slug)}/settings" class="card">
        <label>Key
          <input type="text" name="key" required>
        </label>
        <label>Value
          <input type="password" name="value" required autocomplete="off">
        </label>
        <button type="submit">Save setting</button>
      </form>

      <h2 class="danger-heading">Delete project</h2>
      <p class="muted">This permanently deletes the project database file. This cannot be undone.</p>
      <form method="post" action="/admin/projects/${encodeURIComponent(project.slug)}/delete" class="card danger" data-confirm="delete-project">
        <label>Type the project slug to confirm
          <input type="text" name="confirm" required placeholder="${escapeHtml(project.slug)}">
        </label>
        <button type="submit" class="danger-button">Delete project</button>
      </form>
    `,
  });
}

export function globalSettingsPage({ user, settingKeys, notice }) {
  const keys = settingKeys.map((s) => `<li><code>${escapeHtml(s.key)}</code> <span class="muted">(updated ${escapeHtml(s.updated_at)})</span></li>`).join('\n');

  return layout({
    title: 'Settings',
    user,
    notice,
    body: `
      <h1>Global settings</h1>
      <p class="muted">Values are write-only. Once set, only the key name and last-updated time are shown here, never the value.</p>
      <ul class="setting-list">${keys || '<li class="empty">No settings set.</li>'}</ul>
      <form method="post" action="/admin/settings" class="card">
        <label>Key
          <input type="text" name="key" required>
        </label>
        <label>Value
          <input type="password" name="value" required autocomplete="off">
        </label>
        <button type="submit">Save setting</button>
      </form>
    `,
  });
}

export function errorPage({ status, message }) {
  return layout({
    title: `Error ${status}`,
    nav: false,
    body: `<h1>${status}</h1><p>${escapeHtml(message)}</p>`,
  });
}
