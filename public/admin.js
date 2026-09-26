// Vanilla JS, no framework, no build step.

// Sidebar: mark the nav link for the current page (longest matching href
// prefix wins, so /media beats the bare project-settings link). Styling
// hangs off aria-current in the link's class list.
{
  const links = [...document.querySelectorAll('[data-nav]')];
  const here = location.pathname;
  const best = links
    .filter((a) => here === a.getAttribute('href') || here.startsWith(a.getAttribute('href') + '/'))
    .sort((a, b) => b.getAttribute('href').length - a.getAttribute('href').length)[0];
  if (best) best.setAttribute('aria-current', 'page');
}

// Theme toggle: explicit light/dark choice on <html>, persisted. The
// no-FOUC inline script in <head> applies it on load; this just flips it.
{
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const dark = document.documentElement.classList.toggle('dark');
      try {
        localStorage.theme = dark ? 'dark' : 'light';
      } catch (e) {}
    });
  }
}

// Sidebar collapse: one toggle, both breakpoints. The head script applies the
// state before paint (and forces the rail on phones). Desktop preference is
// persisted; phone open/close is transient so pages open with the menu closed.
{
  const root = document.documentElement;
  const wide = () => matchMedia('(min-width: 768px)').matches;
  const set = (collapsed) => {
    root.classList.toggle('nav-collapsed', collapsed);
    if (wide()) {
      try {
        localStorage.nav = collapsed ? 'collapsed' : 'expanded';
      } catch (e) {}
    }
  };
  for (const el of document.querySelectorAll('[data-nav-toggle]')) {
    el.addEventListener('click', () => set(!root.classList.contains('nav-collapsed')));
  }
  const scrim = document.querySelector('[data-nav-scrim]');
  if (scrim) scrim.addEventListener('click', () => set(true));
}

// Entry editor: the status-card Save button stays disabled until any input
// differs from its loaded value; reverting an edit disables it again. Compare
// against a serialized snapshot so the check is exact, not just "was touched".
{
  const form = document.getElementById('entry-form');
  const save = document.querySelector('[data-entry-save]');
  if (form && save) {
    const snap = () => new URLSearchParams(new FormData(form)).toString();
    const initial = snap();
    const update = () => {
      const dirty = snap() !== initial;
      save.disabled = !dirty;
      if (dirty) save.removeAttribute('title');
      else save.title = 'No unsaved changes yet';
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
  }
}

// Confirm destructive forms. Forms with a confirm input (project and
// collection delete) require the typed slug to match; forms without one
// (entry delete) just ask.
const CONFIRM_MESSAGES = {
  'delete-project': 'This permanently deletes the project database. Continue?',
  'delete-collection': 'This deletes the collection and every entry in it. Continue?',
  'delete-entry': 'Delete this entry? Its revisions go with it.',
  'delete-media': 'Delete this file? Anything embedding it will break.',
  'delete-secret': 'Delete this secret? Anything reading it will break.',
  'cleanup-media': 'Delete the old copies from the previous storage? Entries already point at the current storage, so nothing breaks, but this cannot be undone.',
};

document.addEventListener('submit', (event) => {
  const form = event.target;
  const kind = form.dataset.confirm;
  if (!kind) return;
  // A form may carry its own rendered message (e.g. field delete with usage
  // stats); otherwise fall back to the static keyed message.
  const message = form.dataset.confirmMessage || CONFIRM_MESSAGES[kind];
  if (!message) return;
  const input = form.querySelector('input[name="confirm"]');
  if (input) {
    const expected = input.placeholder;
    if (input.value !== expected) {
      event.preventDefault();
      window.alert(`Type "${expected}" exactly to confirm deletion.`);
      return;
    }
  }
  if (!window.confirm(message)) {
    event.preventDefault();
  }
});

// Project switcher in the sidebar: navigate on change.
const switcher = document.getElementById('project-switcher');
if (switcher) {
  switcher.addEventListener('change', () => {
    const slug = switcher.value;
    if (!slug) return;
    window.location.href = `/admin/projects/${encodeURIComponent(slug)}/collections`;
  });
}

// Copy-to-clipboard buttons (media markdown snippets).
document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-copy]');
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.copy).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = original; }, 1200);
  });
});

// Revision diff modals: open on [data-open-dialog], close on [data-close-dialog]
// or a backdrop click. Native <dialog> gives ESC + focus trap for free.
document.addEventListener('click', (event) => {
  const opener = event.target.closest('[data-open-dialog]');
  if (opener) {
    document.getElementById(opener.dataset.openDialog)?.showModal();
    return;
  }
  const closer = event.target.closest('[data-close-dialog]');
  if (closer) {
    closer.closest('dialog')?.close();
    return;
  }
  // Click on the backdrop (the dialog element itself, outside its content).
  if (event.target.matches('dialog[open]')) event.target.close();
});

// "+" popovers are <details data-popover>: close any open one on outside click.
document.addEventListener('click', (event) => {
  document.querySelectorAll('details[data-popover][open]').forEach((d) => {
    if (!d.contains(event.target)) d.removeAttribute('open');
  });
});

// Vote access only applies to counter and countermap fields: hide it until one is picked.
function syncCounterOnly(form) {
  const typeSel = form.querySelector('select[name="type"]');
  const onlyEl = form.querySelector('[data-counter-only]');
  if (!typeSel || !onlyEl) return;
  onlyEl.hidden = typeSel.value !== 'counter' && typeSel.value !== 'countermap';
}
document.querySelectorAll('form').forEach(syncCounterOnly);
document.addEventListener('change', (event) => {
  if (event.target.matches('select[name="type"]')) syncCounterOnly(event.target.closest('form'));
});

// Field reorder: native HTML5 drag and drop on [data-field] rows. Dropping
// in a new position submits the hidden reorder form with the new order.
document.querySelectorAll('[data-field-list]').forEach((list) => {
  let dragged = null;
  list.querySelectorAll('[data-field]').forEach((row) => {
    row.addEventListener('dragstart', (event) => {
      dragged = row;
      event.dataTransfer.effectAllowed = 'move';
      row.classList.add('opacity-50');
    });
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (!dragged || dragged === row) return;
      const rect = row.getBoundingClientRect();
      const before = event.clientY < rect.top + rect.height / 2;
      row.parentNode.insertBefore(dragged, before ? row : row.nextSibling);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('opacity-50');
      dragged = null;
      const form = list.querySelector('[data-reorder-form]');
      if (!form) return;
      const order = [...list.querySelectorAll('[data-field]')].map((r) => r.dataset.field).join(',');
      if (order !== form.dataset.initial) {
        form.querySelector('input[name="order"]').value = order;
        form.submit();
      }
    });
  });
});

// Direct-to-bucket upload (S3 backend): hash the file, ask the server for a
// presigned PUT, upload from the browser, then register the row. Any failure
// falls back to the normal server-side upload.
document.querySelectorAll('form[data-direct-upload]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    const input = form.querySelector('input[type="file"]');
    const file = input && input.files[0];
    if (!file || !window.crypto || !crypto.subtle) return; // plain submit
    event.preventDefault();
    const base = form.dataset.directUpload;
    const storage = form.querySelector('select[name="storage"]')?.value || '';
    const post = (url, params) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      const presign = await post(`${base}/presign`, { hash, filename: file.name, mime: file.type, storage });
      if (!presign.ok) throw new Error('presign failed');
      const { url, key } = await presign.json();
      const put = await fetch(url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (!put.ok) throw new Error(`bucket PUT ${put.status}`);
      let width = '', height = '';
      if (file.type.startsWith('image/')) {
        try {
          const bmp = await createImageBitmap(file);
          width = bmp.width; height = bmp.height;
        } catch {} // not decodable, dimensions stay unknown
      }
      const reg = await post(`${base}/register`, { key, filename: file.name, mime: file.type, size: file.size, width, height, storage });
      if (!reg.ok) throw new Error('register failed');
      window.location.reload();
    } catch (err) {
      console.warn('direct upload failed, using server upload:', err);
      form.submit();
    }
  });
});

// Field options editor: Edit button toggles the hidden editor panel in its row.
document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-field-edit]');
  if (!btn) return;
  const editor = btn.closest('[data-field]').querySelector('[data-field-editor]');
  if (editor) editor.hidden = !editor.hidden;
});

// Image field picker: clicking a thumbnail writes its URL into the input,
// shows the preview, and closes the popover.
document.addEventListener('click', (event) => {
  const pick = event.target.closest('[data-image-set]');
  if (!pick) return;
  const wrap = pick.closest('[data-image-field]');
  const input = wrap.querySelector('input[type="text"]');
  const preview = wrap.querySelector('[data-image-preview]');
  input.value = pick.dataset.imageSet;
  input.dispatchEvent(new Event('input', { bubbles: true })); // dirty tracker listens on the form
  if (preview) {
    preview.src = pick.dataset.imageSet;
    preview.classList.remove('hidden');
  }
  const popover = pick.closest('details[data-popover]');
  if (popover) popover.removeAttribute('open');
});

// Media search + storage filter: pure client-side show/hide, works both on
// the media page ([data-media-item] cards) and inside image-field picker
// popovers ([data-media-name] buttons scoped to the popover).
function filterMedia(scope) {
  const search = scope.querySelector('[data-media-search]');
  const storageSel = document.querySelector('[data-media-storage-filter]');
  const q = (search?.value || '').trim().toLowerCase();
  const storage = storageSel?.value || '';
  const items = scope === document
    ? document.querySelectorAll('[data-media-item]')
    : scope.querySelectorAll('[data-media-name]');
  items.forEach((el) => {
    const name = el.dataset.mediaName || '';
    const storageOk = !storage || el.dataset.mediaStorage === storage;
    el.hidden = !(name.includes(q) && storageOk);
  });
}
document.addEventListener('input', (event) => {
  if (!event.target.matches('[data-media-search]')) return;
  const popover = event.target.closest('details[data-popover]');
  filterMedia(popover || document);
});
document.querySelector('[data-media-storage-filter]')?.addEventListener('change', () => filterMedia(document));

// Upload a new image straight from the image-field picker: multipart fetch
// with json=1, then set the field to the returned URL.
document.addEventListener('change', async (event) => {
  const input = event.target.closest('[data-image-upload]');
  if (!input || !input.files[0]) return;
  const wrap = input.closest('[data-image-field]');
  const body = new FormData();
  body.append('file', input.files[0]);
  body.append('json', '1');
  input.disabled = true;
  try {
    const res = await fetch(input.dataset.imageUpload, { method: 'POST', body });
    if (!res.ok) throw new Error((await res.json()).error || `upload failed (${res.status})`);
    const { url } = await res.json();
    const field = wrap.querySelector('input[type="text"]');
    const preview = wrap.querySelector('[data-image-preview]');
    field.value = url;
    field.dispatchEvent(new Event('input', { bubbles: true })); // dirty tracker listens on the form
    if (preview) {
      preview.src = url;
      preview.classList.remove('hidden');
    }
    wrap.querySelector('details[data-popover]')?.removeAttribute('open');
  } catch (err) {
    window.alert(err.message || 'Upload failed.');
  } finally {
    input.disabled = false;
    input.value = '';
  }
});

// WebAuthn: passkey registration (account page) and login (login page).
// Native browser API, no library. Server exchanges are small JSON POSTs.
const b64uToBuf = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const bufToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function passkeyFail(err) {
  const el = document.querySelector('[data-passkey-error]');
  if (el) {
    el.textContent = err.message || 'Passkey operation failed.';
    el.hidden = false;
  }
}

const registerBtn = document.querySelector('[data-passkey-register]');
if (registerBtn) {
  registerBtn.addEventListener('click', async () => {
    try {
      const options = await (await fetch('/webauthn/register/options', { method: 'POST' })).json();
      options.challenge = b64uToBuf(options.challenge);
      options.user.id = b64uToBuf(options.user.id);
      options.excludeCredentials = options.excludeCredentials.map((c) => ({ ...c, id: b64uToBuf(c.id) }));
      const cred = await navigator.credentials.create({ publicKey: options });
      const res = await fetch('/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cred.id,
          name: (document.querySelector('[data-passkey-name]')?.value || '').trim(),
          attestationObject: bufToB64u(cred.response.attestationObject),
          clientDataJSON: bufToB64u(cred.response.clientDataJSON),
          transports: cred.response.getTransports ? cred.response.getTransports() : [],
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      window.location.reload();
    } catch (err) {
      passkeyFail(err);
    }
  });
}

const passkeyLoginBtn = document.querySelector('[data-passkey-login]');
if (passkeyLoginBtn) {
  passkeyLoginBtn.addEventListener('click', async () => {
    try {
      const options = await (await fetch('/webauthn/login/options', { method: 'POST' })).json();
      options.challenge = b64uToBuf(options.challenge);
      options.allowCredentials = options.allowCredentials.map((c) => ({ ...c, id: b64uToBuf(c.id) }));
      const cred = await navigator.credentials.get({ publicKey: options });
      const res = await fetch('/webauthn/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: cred.id,
          authenticatorData: bufToB64u(cred.response.authenticatorData),
          clientDataJSON: bufToB64u(cred.response.clientDataJSON),
          signature: bufToB64u(cred.response.signature),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      window.location.href = '/admin/projects';
    } catch (err) {
      passkeyFail(err);
    }
  });
}

// Markdown preview: client-side only, rendered with the vendored marked.js
// into a typeset container. The server never converts markdown. marked (44KB)
// is loaded lazily on first preview so pages without a markdown field never
// fetch it. The import promise is cached so repeat toggles reuse one load.
let markedPromise;
function loadMarked(src) {
  if (!markedPromise) markedPromise = import(src).then((m) => m.marked);
  return markedPromise;
}
document.querySelectorAll('[data-markdown-field]').forEach((wrap) => {
  const toggle = wrap.querySelector('[data-preview-toggle]');
  const textarea = wrap.querySelector('textarea');
  const preview = wrap.querySelector('[data-preview]');
  const src = wrap.getAttribute('data-marked-src');
  if (!toggle || !textarea || !preview) return;
  toggle.addEventListener('click', async () => {
    const showing = !preview.classList.contains('hidden');
    if (showing) {
      preview.classList.add('hidden');
      textarea.classList.remove('hidden');
      toggle.textContent = 'Preview';
    } else {
      preview.classList.remove('hidden');
      textarea.classList.add('hidden');
      toggle.textContent = 'Edit';
      try {
        const marked = await loadMarked(src);
        preview.innerHTML = marked.parse(textarea.value);
      } catch {
        preview.innerHTML = '<p>Preview unavailable.</p>';
      }
    }
  });
});

// Scheduled publishing: the server stores and compares UTC. Show UTC times in
// the viewer's timezone (UTC stays in the tooltip), and convert the local time
// typed into the Publish-at input to UTC on submit.
{
  for (const t of document.querySelectorAll('time[data-utc]')) {
    const d = new Date(t.dataset.utc);
    if (Number.isNaN(d.getTime())) continue;
    t.title = t.dataset.utc + ' (UTC)';
    t.textContent = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  for (const input of document.querySelectorAll('input[data-local-to-utc]')) {
    input.form?.addEventListener('submit', () => {
      const d = new Date(input.value);
      if (input.value && !Number.isNaN(d.getTime())) input.value = d.toISOString().slice(0, 16);
    });
  }
}

// API explorer (API keys page): renders the project's own OpenAPI document as
// an endpoint table (with the key scope each one needs) and a request runner
// below it. The spec is fetched on first paint of that page only, never
// elsewhere. Requests go same-origin from the browser with the key typed here
// (kept in sessionStorage for the tab, never sent to the server except as the
// Authorization header of the request being tested).
{
  const root = document.querySelector('[data-api-explorer]');
  if (root) {
    const INPUT = 'flex h-8 w-full border border-input bg-transparent px-2 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
    const BTN = 'inline-flex items-center justify-center h-7 px-2.5 text-xs font-medium border border-input bg-background shadow-xs hover:bg-accent cursor-pointer disabled:opacity-50';
    const BTN_PRIMARY = 'inline-flex items-center justify-center h-7 px-2.5 text-xs font-medium bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 cursor-pointer disabled:opacity-50';
    const METHOD = { GET: 'text-emerald-700 dark:text-emerald-400', POST: 'text-sky-700 dark:text-sky-400' };
    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const sample = (s) => {
      if (!s) return '';
      if (s.default !== undefined) return s.default;
      if (s.enum) return s.enum[0];
      if (s.type === 'object') {
        const o = {};
        for (const k of s.required || []) o[k] = sample(s.properties?.[k]);
        return o;
      }
      if (s.type === 'array') return [];
      if (s.type === 'integer' || s.type === 'number') return 0;
      if (s.type === 'boolean') return false;
      return '';
    };
    let keyValue = '';
    try { keyValue = sessionStorage.apiExplorerKey || ''; } catch (e) {}

    // Key scope an operation needs: what to create on this page to call it.
    const access = (path, op) => {
      const tone = {
        Public: 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400',
        Read: 'bg-sky-600/15 text-sky-700 dark:text-sky-400',
        Write: 'bg-amber-600/15 text-amber-700 dark:text-amber-400',
      };
      let label = !op.security ? 'Public' : op['x-scope'] === 'write' ? 'Write' : 'Read';
      if (path.startsWith('/mcp/')) label = 'Read + MCP';
      if (label === 'Public' && op['x-auth-note']) label = 'Public*';
      return { label, tone: tone[label.replace('*', '').split(' ')[0]] };
    };
    const badge = (path, op) => {
      const a = access(path, op);
      const b = el('span', `px-1.5 py-0.5 text-xs font-medium shrink-0 ${a.tone}`, a.label);
      if (op['x-auth-note']) b.title = op['x-auth-note'];
      return b;
    };

    const keyRow = el('label', 'flex flex-col gap-1');
    keyRow.append(el('span', 'text-xs font-medium text-muted-foreground', 'API key for requests (a key is shown once when created; paste it here. Not needed for Public endpoints)'));
    const keyInput = el('input', INPUT);
    keyInput.type = 'password';
    keyInput.placeholder = 'yn_...';
    keyInput.autocomplete = 'off';
    keyInput.value = keyValue;
    keyInput.addEventListener('input', () => {
      keyValue = keyInput.value.trim();
      try { sessionStorage.apiExplorerKey = keyValue; } catch (e) {}
    });
    keyRow.append(keyInput);

    // Fill the runner panel with one operation: description, auth, params,
    // body and a Send button with its response pane.
    const runner = (panel, path, method, op, defaultCollection) => {
      panel.textContent = '';
      const head = el('div', 'flex items-center gap-2 text-xs flex-wrap');
      head.append(el('span', `font-semibold w-10 shrink-0 ${METHOD[method] || ''}`, method), el('code', 'break-all', path), badge(path, op));
      panel.append(head);
      if (op.summary) panel.append(el('p', 'text-sm font-medium m-0', op.summary));
      if (op.description) panel.append(el('p', 'text-xs text-muted-foreground m-0', op.description));
      const rl = op['x-rate-limit'];
      if (rl) panel.append(el('p', 'text-xs m-0', (typeof rl.limit === 'number' ? `Rate limit: ${rl.limit}/${rl.per} per ${rl.scope}.` : `Rate limit: none set (${rl.scope} limit, off).`) + ` Applies to ${rl.applies_to}.`));
      panel.append(el('p', 'text-xs m-0', `Access: ${op['x-auth-note'] || (!op.security ? 'public, no key needed.' : op['x-scope'] === 'write' ? 'read + write key (Authorization: Bearer).' : 'any valid key, read or write (Authorization: Bearer).')}`));

      const inputs = [];
      const params = op.parameters || [];
      if (params.length) {
        const grid = el('div', 'grid gap-2 sm:grid-cols-2');
        for (const p of params) {
          const wrap = el('label', 'flex flex-col gap-1 text-xs');
          const label = el('span', 'font-medium text-muted-foreground');
          label.append(`${p.name} `, el('span', p.required ? 'font-semibold text-foreground' : '', `${p.in}, ${p.required ? 'required' : 'optional'}${p.schema?.type ? `, ${p.schema.type}` : ''}${p.schema?.default !== undefined ? `, default ${p.schema.default}` : ''}`));
          wrap.append(label);
          const input = el('input', INPUT);
          input.placeholder = p.schema?.default !== undefined ? String(p.schema.default) : p.schema?.enum ? p.schema.enum.join(' | ') : '';
          if (p.name === 'collection') input.value = defaultCollection;
          if (p.description) input.title = p.description;
          wrap.append(input);
          grid.append(wrap);
          inputs.push({ p, input });
        }
        panel.append(grid);
      }

      const media = op.requestBody?.content;
      const json = media?.['application/json'];
      let textarea = null;
      if (json) {
        textarea = el('textarea', `${INPUT} h-28 font-mono py-2`);
        textarea.spellcheck = false;
        const ex = sample(json.schema);
        textarea.value = typeof ex === 'object' ? JSON.stringify(ex, null, 2) : '';
        const props = Object.entries(json.schema?.properties || {});
        const req = new Set(json.schema?.required || []);
        panel.append(el('span', 'text-xs font-medium text-muted-foreground', 'JSON body'));
        if (props.length) panel.append(el('p', 'text-xs m-0', props.map(([k, v]) => `${k} (${req.has(k) ? 'required' : 'optional'}${v.type ? `, ${v.type}` : ''})`).join('; ')));
        panel.append(textarea);
      } else if (media) {
        panel.append(el('p', 'text-xs text-muted-foreground m-0', 'Multipart upload: use the Media page, or curl -F file=@... with the same URL.'));
      }

      const send = el('button', BTN_PRIMARY, media && !json ? 'Send (no body)' : 'Send request');
      send.type = 'button';
      send.style.width = 'fit-content';
      const out = el('pre', 'text-xs bg-muted p-3 overflow-auto max-h-96 m-0 hidden');
      panel.append(send, out);

      send.addEventListener('click', async () => {
        let url = path;
        const query = new URLSearchParams();
        const headers = {};
        for (const { p, input } of inputs) {
          const v = input.value.trim();
          if (p.in === 'path') { if (v) url = url.replace(`{${p.name}}`, encodeURIComponent(v)); }
          else if (v && p.in === 'query') query.set(p.name, v);
          else if (v && p.in === 'header') headers[p.name] = v;
        }
        out.classList.remove('hidden');
        if (/\{[^}]+\}/.test(url)) {
          out.textContent = 'Fill every path parameter first.';
          return;
        }
        if (query.size) url += `?${query}`;
        if (op.security && keyValue) headers.Authorization = `Bearer ${keyValue}`;
        const init = { method: method.toUpperCase(), headers, cache: 'no-store' };
        if (json && textarea) {
          headers['Content-Type'] = 'application/json';
          init.body = textarea.value;
        }
        send.disabled = true;
        out.textContent = 'Sending...';
        const t0 = performance.now();
        try {
          const res = await fetch(url, init);
          const text = await res.text();
          const ms = Math.round(performance.now() - t0);
          let shown = text;
          try { shown = JSON.stringify(JSON.parse(text), null, 2); } catch (e) {}
          if (shown.length > 20000) shown = `${shown.slice(0, 20000)}\n... truncated (${text.length} bytes)`;
          const heads = [...res.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
          out.textContent = `${init.method} ${url}\n${res.status} ${res.statusText} in ${ms} ms\n\n${heads}\n\n${shown}`;
        } catch (e) {
          out.textContent = `Request failed: ${e.message}`;
        } finally {
          send.disabled = false;
        }
      });
    };

    fetch(root.dataset.spec, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`spec ${r.status}`))))
      .then((spec) => {
        root.textContent = '';
        const byTag = new Map();
        for (const [path, item] of Object.entries(spec.paths)) {
          for (const [method, op] of Object.entries(item)) {
            const tag = op.tags?.[0] || 'other';
            if (!byTag.has(tag)) byTag.set(tag, []);
            byTag.get(tag).push([path, method.toUpperCase(), op]);
          }
        }
        const panel = el('div', 'flex flex-col gap-3');
        const rows = [];
        const select = (row, path, method, op) => {
          for (const r of rows) r.removeAttribute('aria-current');
          row.setAttribute('aria-current', 'true');
          runner(panel, path, method, op, root.dataset.collection || '');
        };
        const table = el('table', 'w-full border-collapse');
        const hr = el('tr', 'border-b border-border bg-muted');
        for (const [c, cls] of [['Method', ''], ['Path', ''], ['Needs', ''], ['Summary', 'hidden md:table-cell']]) hr.append(el('th', `p-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground ${cls}`, c));
        const thead = el('thead');
        thead.append(hr);
        const tbody = el('tbody');
        for (const t of spec.tags || []) {
          const ops = byTag.get(t.name);
          if (!ops) continue;
          const gr = el('tr', 'border-b border-border bg-muted/50');
          const gc = el('td', 'px-3 py-1.5 text-xs font-semibold');
          gc.colSpan = 4;
          gc.append(t.name);
          if (t.description) gc.append(el('span', 'font-normal text-muted-foreground hidden md:inline', `  ${t.description}`));
          gr.append(gc);
          tbody.append(gr);
          for (const [path, method, op] of ops) {
            const tr = el('tr', 'border-b border-border cursor-pointer hover:bg-accent aria-[current=true]:bg-accent');
            tr.tabIndex = 0;
            const c1 = el('td', `p-2 text-xs font-semibold ${METHOD[method] || ''}`, method);
            const c2 = el('td', 'p-2 text-xs');
            c2.append(el('code', 'break-all', path));
            const c3 = el('td', 'p-2');
            c3.append(badge(path, op));
            tr.append(c1, c2, c3, el('td', 'p-2 text-xs text-muted-foreground hidden md:table-cell', op.summary || ''));
            tr.addEventListener('click', () => select(tr, path, method, op));
            tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(tr, path, method, op); } });
            rows.push(tr);
            tbody.append(tr);
          }
        }
        table.append(thead, tbody);
        const tableWrap = el('div', 'border border-border bg-card shadow-xs overflow-x-auto');
        tableWrap.append(table);
        const runnerCard = el('div', 'border border-border border-t-2 border-t-primary bg-card text-card-foreground shadow-xs p-4 flex flex-col gap-3');
        runnerCard.append(el('h2', 'text-sm font-semibold m-0', 'Request runner'), keyRow, panel);
        root.append(tableWrap, runnerCard);
        if (rows[0]) rows[0].click();
      })
      .catch((e) => {
        root.textContent = `Could not load the API spec: ${e.message}`;
      });
  }
}
