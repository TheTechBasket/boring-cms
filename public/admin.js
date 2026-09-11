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
