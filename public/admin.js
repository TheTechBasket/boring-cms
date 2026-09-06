// Vanilla JS, no framework, no build step.

// Confirm destructive forms. Forms with a confirm input (project and
// collection delete) require the typed slug to match; forms without one
// (entry delete) just ask.
const CONFIRM_MESSAGES = {
  'delete-project': 'This permanently deletes the project database. Continue?',
  'delete-collection': 'This deletes the collection and every entry in it. Continue?',
  'delete-entry': 'Delete this entry? Its revisions go with it.',
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
