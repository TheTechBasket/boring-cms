// Vanilla JS, no framework, no build step.

// Confirm destructive forms. Forms with a confirm input (project and
// collection delete) require the typed slug to match; forms without one
// (entry delete) just ask.
const CONFIRM_MESSAGES = {
  'delete-project': 'This permanently deletes the project database. Continue?',
  'delete-collection': 'This deletes the collection and every entry in it. Continue?',
  'delete-entry': 'Delete this entry? Its revisions go with it.',
  'delete-media': 'Delete this file? Anything embedding it will break.',
};

document.addEventListener('submit', (event) => {
  const form = event.target;
  const kind = form.dataset.confirm;
  if (!kind || !(kind in CONFIRM_MESSAGES)) return;
  const input = form.querySelector('input[name="confirm"]');
  if (input) {
    const expected = input.placeholder;
    if (input.value !== expected) {
      event.preventDefault();
      window.alert(`Type "${expected}" exactly to confirm deletion.`);
      return;
    }
  }
  if (!window.confirm(CONFIRM_MESSAGES[kind])) {
    event.preventDefault();
  }
});

// Project switcher in the sidebar: navigate on change.
const switcher = document.getElementById('project-switcher');
if (switcher) {
  switcher.addEventListener('change', () => {
    const slug = switcher.value;
    window.location.href = slug ? `/admin/projects/${encodeURIComponent(slug)}/collections` : '/admin/projects';
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

// Markdown preview: client-side only, rendered with the vendored marked.js
// into a typeset container. The server never converts markdown.
document.querySelectorAll('[data-markdown-field]').forEach((wrap) => {
  const toggle = wrap.querySelector('[data-preview-toggle]');
  const textarea = wrap.querySelector('textarea');
  const preview = wrap.querySelector('[data-preview]');
  if (!toggle || !textarea || !preview) return;
  toggle.addEventListener('click', () => {
    const showing = !preview.classList.contains('hidden');
    if (showing) {
      preview.classList.add('hidden');
      textarea.classList.remove('hidden');
      toggle.textContent = 'Preview';
    } else {
      preview.innerHTML = window.marked ? window.marked.parse(textarea.value) : '<p>Preview unavailable.</p>';
      preview.classList.remove('hidden');
      textarea.classList.add('hidden');
      toggle.textContent = 'Edit';
    }
  });
});
