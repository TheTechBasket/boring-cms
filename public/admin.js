// Vanilla JS, no framework, no build step.
// Confirms destructive forms (project delete) before submit: the slug
// typed into the confirm field must match the placeholder (the real slug).
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form.dataset.confirm !== 'delete-project') return;
  const input = form.querySelector('input[name="confirm"]');
  const expected = input?.placeholder;
  if (!input || input.value !== expected) {
    event.preventDefault();
    window.alert(`Type "${expected}" exactly to confirm deletion.`);
    return;
  }
  if (!window.confirm('This permanently deletes the project database. Continue?')) {
    event.preventDefault();
  }
});
