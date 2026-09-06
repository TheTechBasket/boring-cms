// Server-rendered HTML, as plain template strings. No framework, no build step.

import { entryLabel } from './content.ts';

// Inline Solar duotone icons (allsvgicons MCP, solar:*-bold-duotone).
const ICONS: Record<string, string> = {
  document: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path d="M3 10C3 6.22876 3 4.34315 4.17157 3.17157C5.34315 2 7.22876 2 11 2H13C16.7712 2 18.6569 2 19.8284 3.17157C21 4.34315 21 6.22876 21 10V14C21 17.7712 21 19.6569 19.8284 20.8284C18.6569 22 16.7712 22 13 22H11C7.22876 22 5.34315 22 4.17157 20.8284C3 19.6569 3 17.7712 3 14V10Z" opacity=".5"/><path fill-rule="evenodd" d="M7.25 10C7.25 9.58579 7.58579 9.25 8 9.25H16C16.4142 9.25 16.75 9.58579 16.75 10C16.75 10.4142 16.4142 10.75 16 10.75H8C7.58579 10.75 7.25 10.4142 7.25 10Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M7.25 14C7.25 13.5858 7.58579 13.25 8 13.25H13C13.4142 13.25 13.75 13.5858 13.75 14C13.75 14.4142 13.4142 14.75 13 14.75H8C7.58579 14.75 7.25 14.4142 7.25 14Z" clip-rule="evenodd"/></g></svg>`,
  gallery: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path d="M18 8C18 9.10457 17.1046 10 16 10C14.8954 10 14 9.10457 14 8C14 6.89543 14.8954 6 16 6C17.1046 6 18 6.89543 18 8Z"/><path fill-rule="evenodd" d="M11.9426 1.25H12.0574C14.3658 1.24999 16.1748 1.24998 17.5863 1.43975C19.031 1.63399 20.1711 2.03933 21.0659 2.93414C21.9607 3.82895 22.366 4.96897 22.5603 6.41371C22.75 7.82519 22.75 9.63423 22.75 11.9426V12.0309C22.75 13.9397 22.75 15.5023 22.6463 16.7745C22.5422 18.0531 22.3287 19.1214 21.8509 20.0087C21.6401 20.4001 21.3812 20.7506 21.0659 21.0659C20.1711 21.9607 19.031 22.366 17.5863 22.5603C16.1748 22.75 14.3658 22.75 12.0574 22.75H11.9426C9.63423 22.75 7.82519 22.75 6.41371 22.5603C4.96897 22.366 3.82895 21.9607 2.93414 21.0659C2.14086 20.2726 1.7312 19.2852 1.51335 18.0604C1.29935 16.8573 1.2602 15.3603 1.25207 13.5015C1.25 13.0287 1.25 12.5286 1.25 12.001L1.25 11.9426C1.24999 9.63423 1.24998 7.82519 1.43975 6.41371C1.63399 4.96897 2.03933 3.82895 2.93414 2.93414C3.82895 2.03933 4.96897 1.63399 6.41371 1.43975C7.82519 1.24998 9.63423 1.24999 11.9426 1.25ZM6.61358 2.92637C5.33517 3.09825 4.56445 3.42514 3.9948 3.9948C3.42514 4.56445 3.09825 5.33517 2.92637 6.61358C2.75159 7.91356 2.75 9.62177 2.75 12C2.75 12.5287 2.75 13.0257 2.75205 13.4949C2.76025 15.369 2.80214 16.7406 2.99017 17.7978C3.17436 18.8333 3.48774 19.4981 3.9948 20.0052C4.56445 20.5749 5.33517 20.9018 6.61358 21.0736C7.91356 21.2484 9.62177 21.25 12 21.25C14.3782 21.25 16.0864 21.2484 17.3864 21.0736C18.6648 20.9018 19.4355 20.5749 20.0052 20.0052C20.2151 19.7953 20.3872 19.5631 20.5302 19.2976C20.8619 18.6816 21.0531 17.8578 21.1513 16.6527C21.2494 15.4482 21.25 13.9459 21.25 12C21.25 9.62177 21.2484 7.91356 21.0736 6.61358C20.9018 5.33517 20.5749 4.56445 20.0052 3.9948C19.4355 3.42514 18.6648 3.09825 17.3864 2.92637C16.0864 2.75159 14.3782 2.75 12 2.75C9.62177 2.75 7.91356 2.75159 6.61358 2.92637Z" clip-rule="evenodd"/><path d="M20.6069 19.1463L17.7765 16.599C16.737 15.6634 15.1889 15.5702 14.0446 16.3744L13.7464 16.5839C12.9513 17.1428 11.8695 17.0491 11.1822 16.3618L6.89252 12.0721C6.03631 11.2159 4.66289 11.1702 3.75162 11.9675L2.75049 12.8435C2.75077 13.0665 2.75128 13.2835 2.7522 13.4949C2.7604 15.369 2.80229 16.7406 2.99032 17.7978C3.17451 18.8333 3.48788 19.4981 3.99494 20.0052C4.5646 20.5749 5.33532 20.9018 6.61372 21.0736C7.9137 21.2484 9.62192 21.25 12.0001 21.25C14.3784 21.25 16.0866 21.2484 17.3866 21.0736C18.665 20.9018 19.4357 20.5749 20.0054 20.0052C20.2153 19.7953 20.3873 19.5631 20.5303 19.2976C20.5568 19.2485 20.5823 19.1981 20.6069 19.1463Z" opacity=".5"/></g></svg>`,
  key: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path fill-rule="evenodd" d="M22 8.29344C22 11.7692 19.1708 14.5869 15.6807 14.5869C15.0439 14.5869 13.5939 14.4405 12.8885 13.8551L12.0067 14.7333C11.4883 15.2496 11.6283 15.4016 11.8589 15.652C11.9551 15.7565 12.0672 15.8781 12.1537 16.0505C12.1537 16.0505 12.8885 17.075 12.1537 18.0995C11.7128 18.6849 10.4783 19.5045 9.06754 18.0995L8.77362 18.3922C8.77362 18.3922 9.65538 19.4167 8.92058 20.4412C8.4797 21.0267 7.30403 21.6121 6.27531 20.5876L5.2466 21.6121C4.54119 22.3146 3.67905 21.9048 3.33616 21.6121L2.45441 20.7339C1.63143 19.9143 2.1115 19.0264 2.45441 18.6849L10.0963 11.0743C10.0963 11.0743 9.3615 9.90338 9.3615 8.29344C9.3615 4.81767 12.1907 2 15.6807 2C19.1708 2 22 4.81767 22 8.29344Z" clip-rule="evenodd" opacity=".5"/><path d="M17.8853 8.29353C17.8853 9.50601 16.8984 10.4889 15.681 10.4889C14.4635 10.4889 13.4766 9.50601 13.4766 8.29353C13.4766 7.08105 14.4635 6.09814 15.681 6.09814C16.8984 6.09814 17.8853 7.08105 17.8853 8.29353Z"/></g></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path fill-rule="evenodd" d="M14.2788 2.15224C13.9085 2 13.439 2 12.5 2C11.561 2 11.0915 2 10.7212 2.15224C10.2274 2.35523 9.83509 2.74458 9.63056 3.23463C9.53719 3.45834 9.50065 3.7185 9.48635 4.09799C9.46534 4.65568 9.17716 5.17189 8.69017 5.45093C8.20318 5.72996 7.60864 5.71954 7.11149 5.45876C6.77318 5.2813 6.52789 5.18262 6.28599 5.15102C5.75609 5.08178 5.22018 5.22429 4.79616 5.5472C4.47814 5.78938 4.24339 6.1929 3.7739 6.99993C3.30441 7.80697 3.06967 8.21048 3.01735 8.60491C2.94758 9.1308 3.09118 9.66266 3.41655 10.0835C3.56506 10.2756 3.77377 10.437 4.0977 10.639C4.57391 10.936 4.88032 11.4419 4.88029 12C4.88026 12.5581 4.57386 13.0639 4.0977 13.3608C3.77372 13.5629 3.56497 13.7244 3.41645 13.9165C3.09108 14.3373 2.94749 14.8691 3.01725 15.395C3.06957 15.7894 3.30432 16.193 3.7738 17C4.24329 17.807 4.47804 18.2106 4.79606 18.4527C5.22008 18.7756 5.75599 18.9181 6.28589 18.8489C6.52778 18.8173 6.77305 18.7186 7.11133 18.5412C7.60852 18.2804 8.2031 18.27 8.69012 18.549C9.17714 18.8281 9.46533 19.3443 9.48635 19.9021C9.50065 20.2815 9.53719 20.5417 9.63056 20.7654C9.83509 21.2554 10.2274 21.6448 10.7212 21.8478C11.0915 22 11.561 22 12.5 22C13.439 22 13.9085 22 14.2788 21.8478C14.7726 21.6448 15.1649 21.2554 15.3694 20.7654C15.4628 20.5417 15.4994 20.2815 15.5137 19.902C15.5347 19.3443 15.8228 18.8281 16.3098 18.549C16.7968 18.2699 17.3914 18.2804 17.8886 18.5412C18.2269 18.7186 18.4721 18.8172 18.714 18.8488C19.2439 18.9181 19.7798 18.7756 20.2038 18.4527C20.5219 18.2105 20.7566 17.807 21.2261 16.9999C21.6956 16.1929 21.9303 15.7894 21.9827 15.395C22.0524 14.8691 21.9088 14.3372 21.5835 13.9164C21.4349 13.7243 21.2262 13.5628 20.9022 13.3608C20.4261 13.0639 20.1197 12.558 20.1197 11.9999C20.1197 11.4418 20.4261 10.9361 20.9022 10.6392C21.2263 10.4371 21.435 10.2757 21.5836 10.0835C21.9089 9.66273 22.0525 9.13087 21.9828 8.60497C21.9304 8.21055 21.6957 7.80703 21.2262 7C20.7567 6.19297 20.522 5.78945 20.2039 5.54727C19.7799 5.22436 19.244 5.08185 18.7141 5.15109C18.4722 5.18269 18.2269 5.28136 17.8887 5.4588C17.3915 5.71959 16.7969 5.73002 16.3099 5.45096C15.8229 5.17191 15.5347 4.65566 15.5136 4.09794C15.4993 3.71848 15.4628 3.45833 15.3694 3.23463C15.1649 2.74458 14.7726 2.35523 14.2788 2.15224Z" clip-rule="evenodd" opacity=".5"/><path d="M15.5227 12C15.5227 13.6569 14.1694 15 12.4999 15C10.8304 15 9.47705 13.6569 9.47705 12C9.47705 10.3431 10.8304 9 12.4999 9C14.1694 9 15.5227 10.3431 15.5227 12Z"/></g></svg>`,
  folder: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path d="M22 14V11.7979C22 9.16554 22 7.84935 21.2305 6.99383C21.1598 6.91514 21.0849 6.84024 21.0062 6.76946C20.1506 6 18.8345 6 16.2021 6H15.8284C14.6747 6 14.0979 6 13.5604 5.84678C13.2651 5.7626 12.9804 5.64471 12.7121 5.49543C12.2237 5.22367 11.8158 4.81578 11 4L10.4497 3.44975C10.1763 3.17633 10.0396 3.03961 9.89594 2.92051C9.27652 2.40704 8.51665 2.09229 7.71557 2.01738C7.52976 2 7.33642 2 6.94975 2C6.06722 2 5.62595 2 5.25839 2.06935C3.64031 2.37464 2.37464 3.64031 2.06935 5.25839C2 5.62595 2 6.06722 2 6.94975V14C2 17.7712 2 19.6569 3.17157 20.8284C4.34315 22 6.22876 22 10 22H14C17.7712 22 19.6569 22 20.8284 20.8284C22 19.6569 22 17.7712 22 14Z" opacity=".5"/><path d="M12.25 10C12.25 9.58579 12.5858 9.25 13 9.25H18C18.4142 9.25 18.75 9.58579 18.75 10C18.75 10.4142 18.4142 10.75 18 10.75H13C12.5858 10.75 12.25 10.4142 12.25 10Z"/></g></svg>`,
};

function icon(name: string): string {
  return `<span class="inline-flex text-base leading-none shrink-0" aria-hidden="true">${ICONS[name] || ''}</span>`;
}

// "3m ago" style relative time from SQLite UTC timestamps, with the full
// timestamp kept in a title attribute.
export function timeAgo(ts: string | null | undefined): string {
  if (!ts) return '';
  const date = new Date(`${String(ts).replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return escapeHtml(ts);
  const secs = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  let rel;
  if (secs < 60) rel = 'just now';
  else if (secs < 3600) rel = `${Math.floor(secs / 60)}m ago`;
  else if (secs < 86400) rel = `${Math.floor(secs / 3600)}h ago`;
  else if (secs < 30 * 86400) rel = `${Math.floor(secs / 86400)}d ago`;
  else rel = date.toISOString().slice(0, 10);
  return `<span title="${escapeHtml(ts)} UTC">${rel}</span>`;
}

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

// Header row on a distinct background so tables scan easily.
function tableHead(cols: { label: string; extra?: string }[]): string {
  const ths = cols
    .map((c) => `<th class="p-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground ${c.extra || ''}">${c.label}</th>`)
    .join('\n');
  return `<thead><tr class="border-b border-border bg-muted">${ths}</tr></thead>`;
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

const SIDEBAR_LINK = 'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-sidebar-foreground no-underline hover:bg-sidebar-accent hover:text-sidebar-accent-foreground';

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
        <a class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/collections">${icon('document')}Content</a>
        <a class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/media">${icon('gallery')}Media</a>
        <a class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/api-keys">${icon('key')}API keys</a>
        <a class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}">${icon('settings')}Project settings</a>
      </div>`
    : '';

  return `<aside class="w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col p-3 sticky top-0 h-screen">
    <a class="px-3 py-2 font-bold text-sidebar-foreground no-underline" href="/admin/projects">yncms</a>
    <select id="project-switcher" class="${SELECT_CLASS} bg-sidebar mb-1" title="Switch project">${options}</select>
    ${projectNav}
    <div class="mt-auto flex flex-col gap-0.5 border-t border-sidebar-border pt-3">
      <span class="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Instance</span>
      <a class="${SIDEBAR_LINK}" href="/admin/projects">${icon('folder')}Projects</a>
      <a class="${SIDEBAR_LINK}" href="/admin/settings">${icon('settings')}Global settings</a>
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
        <td class="p-3 text-left @max-lg:hidden text-sm text-muted-foreground">${timeAgo(p.created_at)}</td>
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
        ${tableHead([{ label: 'Name' }, { label: 'Slug' }, { label: 'Created', extra: '@max-lg:hidden' }, { label: '' }])}
        <tbody>${rows || '<tr><td colspan="4" class="p-3 text-muted-foreground italic">No projects yet.</td></tr>'}</tbody>
      </table>`)}
    `,
  });
}

export function projectDetailPage({ user, projects, project, settingKeys, notice: pageNotice }: any): string {
  const keys = settingKeys
    .map((s: any) => `<li class="py-1.5 border-b border-border"><code class="text-sm">${escapeHtml(s.key)}</code> <span class="text-muted-foreground text-sm">(updated ${timeAgo(s.updated_at)})</span></li>`)
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
    .map((s: any) => `<li class="py-1.5 border-b border-border"><code class="text-sm">${escapeHtml(s.key)}</code> <span class="text-muted-foreground text-sm">(updated ${timeAgo(s.updated_at)})</span></li>`)
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
        ${tableHead([{ label: 'Collection' }, { label: 'Slug' }, { label: 'Fields' }])}
        <tbody>${rows || '<tr><td colspan="3" class="p-3 text-muted-foreground italic">No collections yet. Create one with the + button, for example Posts or Pages.</td></tr>'}</tbody>
      </table>`)}
    `,
  });
}

export function collectionPage({ user, projects, project, collection, entries, fieldTypes, notice: pageNotice }: any): string {
  const base = `/admin/projects/${project.slug}/collections/${collection.slug}`;

  const gripIcon = `<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/><circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>`;

  // Small labeled input for the per-field options editor. Placeholders show
  // the conventional default for each limit; empty means "no constraint".
  const opt = (f: any, name: string, label: string, { type = 'text', placeholder = '' } = {}) =>
    `<label class="flex flex-col gap-1 text-xs">
      <span class="font-medium text-muted-foreground">${label}</span>
      <input type="${type}" name="${name}" value="${f[name] !== undefined ? escapeHtml(f[name]) : ''}" placeholder="${escapeHtml(placeholder)}" class="${INPUT_CLASS} h-8">
    </label>`;

  const fieldEditor = (f: any) => {
    const typeSel = fieldTypes
      .map((t: string) => `<option value="${t}"${t === f.type ? ' selected' : ''}>${t}</option>`)
      .join('');
    const textish = f.type === 'text' || f.type === 'markdown' || f.type === 'image';
    const constraints = f.type === 'number'
      ? `${opt(f, 'min', 'Min', { type: 'number' })}${opt(f, 'max', 'Max', { type: 'number' })}${opt(f, 'step', 'Step', { placeholder: 'any' })}`
      : f.type === 'date'
        ? `${opt(f, 'min', 'Earliest', { placeholder: 'YYYY-MM-DD' })}${opt(f, 'max', 'Latest', { placeholder: 'YYYY-MM-DD' })}`
        : textish
          ? `${opt(f, 'minlength', 'Min length', { type: 'number', placeholder: '0' })}${opt(f, 'maxlength', 'Max length', { type: 'number', placeholder: f.type === 'text' ? '280' : '100000' })}${f.type === 'text' ? opt(f, 'pattern', 'Pattern (regex)', { placeholder: '.*' }) : ''}${f.type === 'image' ? opt(f, 'accept', 'Accept', { placeholder: 'image/*' }) : ''}`
          : '';
    return `<form method="post" action="${base}/fields/update" class="grid grid-cols-2 gap-3 border-b border-border bg-muted/50 px-4 py-4">
      <input type="hidden" name="field" value="${escapeHtml(f.name)}">
      ${opt(f, 'label', 'Label')}
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-medium text-muted-foreground">Type</span>
        <select name="type" class="${SELECT_CLASS} h-8">${typeSel}</select>
      </label>
      ${opt(f, 'help', 'Help text', { placeholder: 'Shown under the input' })}
      ${opt(f, 'placeholder', 'Placeholder')}
      ${f.type === 'boolean' ? '' : opt(f, 'default', 'Default value')}
      ${constraints}
      <label class="col-span-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input type="checkbox" name="required" value="1"${f.required ? ' checked' : ''} class="size-3.5 accent-primary"> Required
      </label>
      <div class="col-span-2">${button({ label: 'Save field', small: true })}</div>
    </form>`;
  };

  const fieldRows = collection.fields
    .map(
      (f: any) => `<div draggable="true" data-field="${escapeHtml(f.name)}" class="bg-card">
        <div class="flex items-center gap-3 border-b border-border px-3 py-2 text-sm cursor-grab">
          <span class="text-muted-foreground shrink-0" aria-hidden="true">${gripIcon}</span>
          <span class="font-medium">${escapeHtml(f.label)}</span>
          <code class="text-muted-foreground">${escapeHtml(f.name)}</code>
          <span class="text-muted-foreground">${escapeHtml(f.type)}</span>
          ${f.required ? '<span class="text-xs font-medium text-primary-foreground bg-primary px-1.5 py-0.5">required</span>' : ''}
          <button type="button" data-field-edit class="ml-auto text-xs text-primary hover:underline cursor-pointer bg-transparent border-0 p-0">Edit</button>
          <form method="post" action="${base}/fields/remove">
            <input type="hidden" name="field" value="${escapeHtml(f.name)}">
            ${button({ label: 'Remove', variant: 'ghost', small: true })}
          </form>
        </div>
        <div data-field-editor hidden>${fieldEditor(f)}</div>
      </div>`,
    )
    .join('\n');

  const initialOrder = collection.fields.map((f: any) => f.name).join(',');

  const entryRows = entries
    .map(
      (e: any) => `<tr class="border-b border-border">
        <td class="p-3"><a class="text-foreground font-medium no-underline hover:text-primary" href="${base}/${e.slug}">${escapeHtml(entryLabel(e, collection))}</a></td>
        <td class="p-3">${statusBadge(e.status)}</td>
        <td class="p-3 text-sm text-muted-foreground @max-lg:hidden">${timeAgo(e.updated_at)}</td>
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
        ${tableHead([{ label: 'Entry' }, { label: 'Status' }, { label: 'Updated', extra: '@max-lg:hidden' }])}
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

function fieldInput(f: any, value: unknown, { media = [], projectSlug = '' }: any = {}): string {
  // New entries prefill the field default; existing values win.
  const v = value ?? f.default ?? '';
  const help = f.help ? `<span class="text-xs text-muted-foreground">${escapeHtml(f.help)}</span>` : '';
  // Native constraint attributes mirror server-side validateEntryData, so
  // most mistakes are caught before the form ever submits.
  const constraintAttrs = [
    f.required ? 'required' : '',
    f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : '',
    f.minlength ? `minlength="${escapeHtml(f.minlength)}"` : '',
    f.maxlength ? `maxlength="${escapeHtml(f.maxlength)}"` : '',
    f.min !== undefined ? `min="${escapeHtml(f.min)}"` : '',
    f.max !== undefined ? `max="${escapeHtml(f.max)}"` : '',
    f.step ? `step="${escapeHtml(f.step)}"` : '',
    f.pattern ? `pattern="${escapeHtml(f.pattern)}"` : '',
  ].filter(Boolean).join(' ');

  switch (f.type) {
    case 'markdown':
      return `<div class="flex flex-col gap-1.5 text-sm" data-markdown-field>
        <div class="flex items-center justify-between">
          <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
          <button type="button" data-preview-toggle class="text-xs text-primary hover:underline cursor-pointer bg-transparent border-0 p-0">Preview</button>
        </div>
        <textarea name="field_${f.name}" class="${TEXTAREA_CLASS}" rows="14" ${constraintAttrs}>${escapeHtml(v)}</textarea>
        ${help}
        <div data-preview class="typeset rounded-md border border-border bg-card p-4 hidden"></div>
      </div>`;
    case 'boolean':
      return `<label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="field_${f.name}" value="1"${v ? ' checked' : ''} class="size-4 accent-primary">
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        ${help}
      </label>`;
    case 'json': {
      const raw = typeof v === 'string' ? v : v === '' ? '' : JSON.stringify(v, null, 2);
      return `<label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        <textarea name="field_${f.name}" class="${TEXTAREA_CLASS}" rows="10" placeholder="{ }" spellcheck="false"${f.required ? ' required' : ''}>${escapeHtml(raw)}</textarea>
        ${help}
      </label>`;
    }
    case 'image': {
      const images = media.filter((m: any) => m.mime?.startsWith('image/'));
      const pickerCards = images
        .map((m: any) => {
          const url = `/media/${projectSlug}/${m.key}`;
          const thumb = m.variants?.thumb ? `/media/${projectSlug}/${m.variants.thumb}` : url;
          return `<button type="button" data-image-set="${escapeHtml(url)}" class="border border-border bg-card p-0 cursor-pointer hover:border-primary" title="${escapeHtml(m.filename)}">
            <img src="${thumb}" alt="${escapeHtml(m.filename)}" loading="lazy" class="h-20 w-full object-cover">
          </button>`;
        })
        .join('');
      return `<div class="flex flex-col gap-1.5 text-sm" data-image-field>
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        <div class="flex gap-2">
          <input type="text" name="field_${f.name}" value="${escapeHtml(v)}" class="${INPUT_CLASS}" ${constraintAttrs}>
          <details class="relative shrink-0" data-popover>
            <summary class="${BUTTON_BASE} ${BUTTON_VARIANTS.outline} list-none select-none [&::-webkit-details-marker]:hidden">Browse</summary>
            <div class="absolute right-0 top-full mt-2 z-10 w-96 max-h-80 overflow-y-auto border border-border bg-popover shadow-lg p-3">
              ${images.length ? `<div class="grid grid-cols-3 gap-2">${pickerCards}</div>` : '<p class="text-xs text-muted-foreground m-0">No images in the media library yet.</p>'}
            </div>
          </details>
        </div>
        <img data-image-preview src="${escapeHtml(v)}" alt="" class="max-h-40 w-fit border border-border${v ? '' : ' hidden'}">
        ${help}
      </div>`;
    }
    case 'number':
      return `<label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        <input type="number" name="field_${f.name}" value="${escapeHtml(v)}" class="${INPUT_CLASS}" ${constraintAttrs}>
        ${help}
      </label>`;
    case 'date':
      return `<label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        <input type="date" name="field_${f.name}" value="${escapeHtml(v)}" class="${INPUT_CLASS}" ${constraintAttrs}>
        ${help}
      </label>`;
    default:
      return `<label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        <input type="text" name="field_${f.name}" value="${escapeHtml(v)}" class="${INPUT_CLASS}" ${constraintAttrs}>
        ${help}
      </label>`;
  }
}

export function entryEditorPage({ user, projects, project, collection, entry, revisions = [], media = [], draft, notice: pageNotice }: any): string {
  const base = `/admin/projects/${project.slug}/collections/${collection.slug}`;
  const isNew = !entry;
  const action = isNew ? `${base}/new` : `${base}/${entry.slug}`;
  // draft = rejected submission values re-rendered so nothing typed is lost.
  const data = entry?.data ?? draft ?? {};
  const blank = isNew && !draft;

  const fieldInputs = collection.fields
    .map((f: any) => fieldInput(f, blank ? undefined : data[f.name] ?? '', { media, projectSlug: project.slug }))
    .join('\n');

  const revisionRows = revisions
    .map((r: any) => {
      const fields = Object.keys(r.changed).map((k) => (k === '__title' ? 'title' : k)).join(', ');
      return `<li class="flex items-center justify-between gap-2 py-1.5 border-b border-border text-sm">
        <span class="text-muted-foreground min-w-0 truncate">${timeAgo(r.created_at)} · changed: ${escapeHtml(fields)}</span>
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
          <p class="text-xs text-muted-foreground">Slug: <code>${escapeHtml(entry.slug)}</code><br>Updated: ${timeAgo(entry.updated_at)}${entry.published_at ? `<br>Published: ${timeAgo(entry.published_at)}` : ''}</p>
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
        <td class="p-2 text-sm text-muted-foreground">${timeAgo(k.created_at)}</td>
        <td class="p-2 text-sm text-muted-foreground">${k.last_used_at ? timeAgo(k.last_used_at) : 'never'}</td>
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
        ${tableHead([{ label: 'Name' }, { label: 'Created' }, { label: 'Last used' }, { label: '' }])}
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
