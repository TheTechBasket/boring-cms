// Server-rendered HTML, as plain template strings. No framework, no build step.

import { readFileSync, statSync } from 'node:fs';
import { entryLabel, isoUtc, REVISIONS_KEEP } from './content.ts';

export const APP_NAME = 'Boring CMS';
export const APP_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

// Cache-busting version per static asset: file mtime at process start.
// Deploys rewrite the files, restart the process, and the query string
// changes, so serveStatic can send long immutable cache headers.
function assetVersion(rel: string): string {
  try {
    return Math.round(statSync(new URL(`../public/${rel}`, import.meta.url)).mtimeMs).toString(36);
  } catch {
    return APP_VERSION;
  }
}
const ADMIN_CSS_V = assetVersion('admin.css');
const ADMIN_JS_V = assetVersion('admin.js');
const MARKED_V = assetVersion('vendor/marked.esm.js');

// Inline Solar duotone icons (allsvgicons MCP, solar:*-bold-duotone).
const ICONS: Record<string, string> = {
  document: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path d="M3 10C3 6.22876 3 4.34315 4.17157 3.17157C5.34315 2 7.22876 2 11 2H13C16.7712 2 18.6569 2 19.8284 3.17157C21 4.34315 21 6.22876 21 10V14C21 17.7712 21 19.6569 19.8284 20.8284C18.6569 22 16.7712 22 13 22H11C7.22876 22 5.34315 22 4.17157 20.8284C3 19.6569 3 17.7712 3 14V10Z" opacity=".5"/><path fill-rule="evenodd" d="M7.25 10C7.25 9.58579 7.58579 9.25 8 9.25H16C16.4142 9.25 16.75 9.58579 16.75 10C16.75 10.4142 16.4142 10.75 16 10.75H8C7.58579 10.75 7.25 10.4142 7.25 10Z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M7.25 14C7.25 13.5858 7.58579 13.25 8 13.25H13C13.4142 13.25 13.75 13.5858 13.75 14C13.75 14.4142 13.4142 14.75 13 14.75H8C7.58579 14.75 7.25 14.4142 7.25 14Z" clip-rule="evenodd"/></g></svg>`,
  gallery: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path d="M18 8C18 9.10457 17.1046 10 16 10C14.8954 10 14 9.10457 14 8C14 6.89543 14.8954 6 16 6C17.1046 6 18 6.89543 18 8Z"/><path fill-rule="evenodd" d="M11.9426 1.25H12.0574C14.3658 1.24999 16.1748 1.24998 17.5863 1.43975C19.031 1.63399 20.1711 2.03933 21.0659 2.93414C21.9607 3.82895 22.366 4.96897 22.5603 6.41371C22.75 7.82519 22.75 9.63423 22.75 11.9426V12.0309C22.75 13.9397 22.75 15.5023 22.6463 16.7745C22.5422 18.0531 22.3287 19.1214 21.8509 20.0087C21.6401 20.4001 21.3812 20.7506 21.0659 21.0659C20.1711 21.9607 19.031 22.366 17.5863 22.5603C16.1748 22.75 14.3658 22.75 12.0574 22.75H11.9426C9.63423 22.75 7.82519 22.75 6.41371 22.5603C4.96897 22.366 3.82895 21.9607 2.93414 21.0659C2.14086 20.2726 1.7312 19.2852 1.51335 18.0604C1.29935 16.8573 1.2602 15.3603 1.25207 13.5015C1.25 13.0287 1.25 12.5286 1.25 12.001L1.25 11.9426C1.24999 9.63423 1.24998 7.82519 1.43975 6.41371C1.63399 4.96897 2.03933 3.82895 2.93414 2.93414C3.82895 2.03933 4.96897 1.63399 6.41371 1.43975C7.82519 1.24998 9.63423 1.24999 11.9426 1.25ZM6.61358 2.92637C5.33517 3.09825 4.56445 3.42514 3.9948 3.9948C3.42514 4.56445 3.09825 5.33517 2.92637 6.61358C2.75159 7.91356 2.75 9.62177 2.75 12C2.75 12.5287 2.75 13.0257 2.75205 13.4949C2.76025 15.369 2.80214 16.7406 2.99017 17.7978C3.17436 18.8333 3.48774 19.4981 3.9948 20.0052C4.56445 20.5749 5.33517 20.9018 6.61358 21.0736C7.91356 21.2484 9.62177 21.25 12 21.25C14.3782 21.25 16.0864 21.2484 17.3864 21.0736C18.6648 20.9018 19.4355 20.5749 20.0052 20.0052C20.2151 19.7953 20.3872 19.5631 20.5302 19.2976C20.8619 18.6816 21.0531 17.8578 21.1513 16.6527C21.2494 15.4482 21.25 13.9459 21.25 12C21.25 9.62177 21.2484 7.91356 21.0736 6.61358C20.9018 5.33517 20.5749 4.56445 20.0052 3.9948C19.4355 3.42514 18.6648 3.09825 17.3864 2.92637C16.0864 2.75159 14.3782 2.75 12 2.75C9.62177 2.75 7.91356 2.75159 6.61358 2.92637Z" clip-rule="evenodd"/><path d="M20.6069 19.1463L17.7765 16.599C16.737 15.6634 15.1889 15.5702 14.0446 16.3744L13.7464 16.5839C12.9513 17.1428 11.8695 17.0491 11.1822 16.3618L6.89252 12.0721C6.03631 11.2159 4.66289 11.1702 3.75162 11.9675L2.75049 12.8435C2.75077 13.0665 2.75128 13.2835 2.7522 13.4949C2.7604 15.369 2.80229 16.7406 2.99032 17.7978C3.17451 18.8333 3.48788 19.4981 3.99494 20.0052C4.5646 20.5749 5.33532 20.9018 6.61372 21.0736C7.9137 21.2484 9.62192 21.25 12.0001 21.25C14.3784 21.25 16.0866 21.2484 17.3866 21.0736C18.665 20.9018 19.4357 20.5749 20.0054 20.0052C20.2153 19.7953 20.3873 19.5631 20.5303 19.2976C20.5568 19.2485 20.5823 19.1981 20.6069 19.1463Z" opacity=".5"/></g></svg>`,
  key: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path fill-rule="evenodd" d="M22 8.29344C22 11.7692 19.1708 14.5869 15.6807 14.5869C15.0439 14.5869 13.5939 14.4405 12.8885 13.8551L12.0067 14.7333C11.4883 15.2496 11.6283 15.4016 11.8589 15.652C11.9551 15.7565 12.0672 15.8781 12.1537 16.0505C12.1537 16.0505 12.8885 17.075 12.1537 18.0995C11.7128 18.6849 10.4783 19.5045 9.06754 18.0995L8.77362 18.3922C8.77362 18.3922 9.65538 19.4167 8.92058 20.4412C8.4797 21.0267 7.30403 21.6121 6.27531 20.5876L5.2466 21.6121C4.54119 22.3146 3.67905 21.9048 3.33616 21.6121L2.45441 20.7339C1.63143 19.9143 2.1115 19.0264 2.45441 18.6849L10.0963 11.0743C10.0963 11.0743 9.3615 9.90338 9.3615 8.29344C9.3615 4.81767 12.1907 2 15.6807 2C19.1708 2 22 4.81767 22 8.29344Z" clip-rule="evenodd" opacity=".5"/><path d="M17.8853 8.29353C17.8853 9.50601 16.8984 10.4889 15.681 10.4889C14.4635 10.4889 13.4766 9.50601 13.4766 8.29353C13.4766 7.08105 14.4635 6.09814 15.681 6.09814C16.8984 6.09814 17.8853 7.08105 17.8853 8.29353Z"/></g></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path fill-rule="evenodd" d="M14.2788 2.15224C13.9085 2 13.439 2 12.5 2C11.561 2 11.0915 2 10.7212 2.15224C10.2274 2.35523 9.83509 2.74458 9.63056 3.23463C9.53719 3.45834 9.50065 3.7185 9.48635 4.09799C9.46534 4.65568 9.17716 5.17189 8.69017 5.45093C8.20318 5.72996 7.60864 5.71954 7.11149 5.45876C6.77318 5.2813 6.52789 5.18262 6.28599 5.15102C5.75609 5.08178 5.22018 5.22429 4.79616 5.5472C4.47814 5.78938 4.24339 6.1929 3.7739 6.99993C3.30441 7.80697 3.06967 8.21048 3.01735 8.60491C2.94758 9.1308 3.09118 9.66266 3.41655 10.0835C3.56506 10.2756 3.77377 10.437 4.0977 10.639C4.57391 10.936 4.88032 11.4419 4.88029 12C4.88026 12.5581 4.57386 13.0639 4.0977 13.3608C3.77372 13.5629 3.56497 13.7244 3.41645 13.9165C3.09108 14.3373 2.94749 14.8691 3.01725 15.395C3.06957 15.7894 3.30432 16.193 3.7738 17C4.24329 17.807 4.47804 18.2106 4.79606 18.4527C5.22008 18.7756 5.75599 18.9181 6.28589 18.8489C6.52778 18.8173 6.77305 18.7186 7.11133 18.5412C7.60852 18.2804 8.2031 18.27 8.69012 18.549C9.17714 18.8281 9.46533 19.3443 9.48635 19.9021C9.50065 20.2815 9.53719 20.5417 9.63056 20.7654C9.83509 21.2554 10.2274 21.6448 10.7212 21.8478C11.0915 22 11.561 22 12.5 22C13.439 22 13.9085 22 14.2788 21.8478C14.7726 21.6448 15.1649 21.2554 15.3694 20.7654C15.4628 20.5417 15.4994 20.2815 15.5137 19.902C15.5347 19.3443 15.8228 18.8281 16.3098 18.549C16.7968 18.2699 17.3914 18.2804 17.8886 18.5412C18.2269 18.7186 18.4721 18.8172 18.714 18.8488C19.2439 18.9181 19.7798 18.7756 20.2038 18.4527C20.5219 18.2105 20.7566 17.807 21.2261 16.9999C21.6956 16.1929 21.9303 15.7894 21.9827 15.395C22.0524 14.8691 21.9088 14.3372 21.5835 13.9164C21.4349 13.7243 21.2262 13.5628 20.9022 13.3608C20.4261 13.0639 20.1197 12.558 20.1197 11.9999C20.1197 11.4418 20.4261 10.9361 20.9022 10.6392C21.2263 10.4371 21.435 10.2757 21.5836 10.0835C21.9089 9.66273 22.0525 9.13087 21.9828 8.60497C21.9304 8.21055 21.6957 7.80703 21.2262 7C20.7567 6.19297 20.522 5.78945 20.2039 5.54727C19.7799 5.22436 19.244 5.08185 18.7141 5.15109C18.4722 5.18269 18.2269 5.28136 17.8887 5.4588C17.3915 5.71959 16.7969 5.73002 16.3099 5.45096C15.8229 5.17191 15.5347 4.65566 15.5136 4.09794C15.4993 3.71848 15.4628 3.45833 15.3694 3.23463C15.1649 2.74458 14.7726 2.35523 14.2788 2.15224Z" clip-rule="evenodd" opacity=".5"/><path d="M15.5227 12C15.5227 13.6569 14.1694 15 12.4999 15C10.8304 15 9.47705 13.6569 9.47705 12C9.47705 10.3431 10.8304 9 12.4999 9C14.1694 9 15.5227 10.3431 15.5227 12Z"/></g></svg>`,
  folder: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path d="M22 14V11.7979C22 9.16554 22 7.84935 21.2305 6.99383C21.1598 6.91514 21.0849 6.84024 21.0062 6.76946C20.1506 6 18.8345 6 16.2021 6H15.8284C14.6747 6 14.0979 6 13.5604 5.84678C13.2651 5.7626 12.9804 5.64471 12.7121 5.49543C12.2237 5.22367 11.8158 4.81578 11 4L10.4497 3.44975C10.1763 3.17633 10.0396 3.03961 9.89594 2.92051C9.27652 2.40704 8.51665 2.09229 7.71557 2.01738C7.52976 2 7.33642 2 6.94975 2C6.06722 2 5.62595 2 5.25839 2.06935C3.64031 2.37464 2.37464 3.64031 2.06935 5.25839C2 5.62595 2 6.06722 2 6.94975V14C2 17.7712 2 19.6569 3.17157 20.8284C4.34315 22 6.22876 22 10 22H14C17.7712 22 19.6569 22 20.8284 20.8284C22 19.6569 22 17.7712 22 14Z" opacity=".5"/><path d="M12.25 10C12.25 9.58579 12.5858 9.25 13 9.25H18C18.4142 9.25 18.75 9.58579 18.75 10C18.75 10.4142 18.4142 10.75 18 10.75H13C12.5858 10.75 12.25 10.4142 12.25 10Z"/></g></svg>`,
  transfer: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path d="M20 10.25C20.3093 10.25 20.5869 10.0602 20.699 9.77191C20.8111 9.48366 20.7348 9.15614 20.5068 8.94715L14.5068 3.44715C14.2875 3.24617 13.9703 3.19374 13.698 3.3135C13.4258 3.43327 13.25 3.70259 13.25 4.00002L13.25 20C13.25 20.4142 13.5858 20.75 14 20.75C14.4142 20.75 14.75 20.4142 14.75 20L14.75 10.25L20 10.25Z"/><path d="M4.00003 13.75L9.25003 13.75L9.25003 4C9.25003 3.58579 9.58581 3.25 10 3.25C10.4142 3.25 10.75 3.58579 10.75 4V20C10.75 20.2974 10.5743 20.5667 10.302 20.6865C10.0298 20.8063 9.71248 20.7538 9.49323 20.5529L3.49324 15.0529C3.26524 14.8439 3.18892 14.5164 3.30105 14.2281C3.41317 13.9399 3.69074 13.75 4.00003 13.75Z" opacity=".5"/></g></svg>`,
  user: `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><g fill="currentColor"><path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" opacity=".5"/><path d="M16.807 19.0112C15.4398 19.9504 13.7841 20.5 12 20.5C10.2159 20.5 8.56023 19.9503 7.193 19.0111C6.58915 18.5963 6.33109 17.8062 6.68219 17.1632C7.41001 15.8302 8.90973 15 12 15C15.0903 15 16.59 15.8303 17.3178 17.1632C17.6689 17.8062 17.4108 18.5964 16.807 19.0112Z"/><path d="M12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3432 6 9.00004 7.34315 9.00004 9C9.00004 10.6569 10.3432 12 12 12Z"/></g></svg>`,
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
  'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ' +
  'disabled:pointer-events-none disabled:opacity-50 h-9 px-4 py-2 w-fit cursor-pointer';

const BUTTON_VARIANTS: Record<string, string> = {
  default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
  destructive: 'bg-destructive text-white shadow-xs hover:bg-destructive/90',
  outline: 'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  'ghost-destructive': 'text-destructive hover:bg-destructive/10',
};

function button({ label, variant = 'default', type = 'submit', small = false, name, value }: {
  label: string; variant?: string; type?: string; small?: boolean; name?: string; value?: string;
}): string {
  const size = small ? 'h-7 px-2.5 text-xs' : '';
  const extra = (name ? ` name="${name}"` : '') + (value !== undefined ? ` value="${escapeHtml(value)}"` : '');
  return `<button type="${type}"${extra} class="${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${size}">${escapeHtml(label)}</button>`;
}

const INPUT_CLASS =
  'flex h-9 w-full border border-input bg-transparent px-3 py-1 text-sm shadow-xs ' +
  'transition-colors placeholder:text-muted-foreground focus-visible:outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

const TEXTAREA_CLASS = INPUT_CLASS.replace('h-9', 'h-96 py-2 font-mono leading-relaxed resize-y overflow-y-auto');

const SELECT_CLASS =
  'flex h-9 w-full items-center border border-input bg-transparent px-3 py-1 text-sm shadow-xs ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer';

function field({ label, name, type = 'text', required = false, value, placeholder, autofocus = false, minlength, autocomplete, help }: {
  label: string; name: string; type?: string; required?: boolean; value?: string;
  placeholder?: string; autofocus?: boolean; minlength?: number; autocomplete?: string; help?: string;
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
    ${help ? `<span class="text-xs text-muted-foreground font-normal">${escapeHtml(help)}</span>` : ''}
  </label>`;
}

const CARD_CLASS =
  'border border-border bg-card text-card-foreground shadow-xs p-6 flex flex-col gap-4';

const FILE_INPUT_CLASS =
  'text-sm file:mr-3 file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:cursor-pointer';

// Labeled <select> matching field(); options: [{value, label, selected?}].
function selectField({ label, name, options, required = false, help }: {
  label: string; name: string; required?: boolean; help?: string;
  options: { value: string; label: string; selected?: boolean }[];
}): string {
  const opts = options
    .map((o) => `<option value="${escapeHtml(o.value)}"${o.selected ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
    .join('');
  return `<label class="flex flex-col gap-1.5 text-sm">
    <span class="font-medium text-foreground">${escapeHtml(label)}</span>
    <select name="${name}"${required ? ' required' : ''} class="${SELECT_CLASS}">${opts}</select>
    ${help ? `<span class="text-xs text-muted-foreground">${escapeHtml(help)}</span>` : ''}
  </label>`;
}

function checkbox({ name, label, checked = false }: { name: string; label: string; checked?: boolean }): string {
  return `<label class="flex items-center gap-2 text-sm">
    <input type="checkbox" name="${name}" value="1"${checked ? ' checked' : ''} class="size-4 accent-primary">
    <span>${escapeHtml(label)}</span>
  </label>`;
}

function preBlock(content: string): string {
  return `<pre class="text-xs bg-muted p-3 overflow-x-auto m-0"><code>${escapeHtml(content)}</code></pre>`;
}

// Write-only secrets table (Name / Updated / Actions), shared by project and
// global settings pages. Standard secrets-manager UI: names and last-updated
// only, edit re-enters the value (never shown), delete removes it outright.
function secretsTable(settingKeys: any[], base: string): string {
  const rows = settingKeys
    .map(
      (s: any) => `<tr class="border-b border-border">
        <td class="p-3"><code class="text-sm">${escapeHtml(s.key)}</code></td>
        <td class="p-3 text-sm text-muted-foreground">${timeAgo(s.updated_at)}</td>
        <td class="p-3 text-right whitespace-nowrap">
          <a href="${base}?edit=${encodeURIComponent(s.key)}" class="text-link text-sm no-underline hover:underline mr-3">Edit</a>
          <form method="post" action="${base}/delete" class="inline" data-confirm="delete-secret">
            <input type="hidden" name="key" value="${escapeHtml(s.key)}">
            <button type="submit" class="text-destructive text-sm bg-transparent border-0 p-0 cursor-pointer hover:underline">Delete</button>
          </form>
        </td>
      </tr>`,
    )
    .join('\n');
  return tableCard(`<table class="w-full border-collapse">
    ${tableHead([{ label: 'Name' }, { label: 'Last updated' }, { label: '' }])}
    <tbody>${rows || '<tr><td colspan="3" class="p-3 text-muted-foreground italic">No secrets set.</td></tr>'}</tbody>
  </table>`);
}

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
  return `<p class="border px-4 py-3 text-sm ${variant}">${escapeHtml(message)}</p>`;
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

// One popover primitive for every disclosure: create forms, upload forms,
// the media browser. summary is a button; panel drops below, right-aligned.
function popover({ summary, variant = 'default', panelClass = 'w-80 p-5', wrapClass = '', children }: {
  summary: string; variant?: string; panelClass?: string; wrapClass?: string; children: string;
}): string {
  return `<details class="relative ${wrapClass}" data-popover>
    <summary class="${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} list-none select-none [&::-webkit-details-marker]:hidden">${summary}</summary>
    <div class="popover-panel absolute right-0 top-full mt-2 z-10 border border-border bg-popover text-popover-foreground shadow-lg ${panelClass}">
      ${children}
    </div>
  </details>`;
}

// A "+" button in the page header that opens a small popover form. All
// create actions use this instead of always-visible forms.
function addPopover({ label, action, children }: { label: string; action: string; children: string }): string {
  return popover({
    summary: `+ ${escapeHtml(label)}`,
    children: `<form method="post" action="${action}" class="flex flex-col gap-4">${children}</form>`,
  });
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
  project?: { slug: string; name: string; icon?: string } | null;
  notice?: { type: string; message: string } | null;
  bare?: boolean; // auth pages: no sidebar
};

// Default mark, or the open project's own icon: an image URL used directly,
// an emoji rendered into the same SVG badge, or nothing (falls back).
function favicon(project: LayoutOpts['project']): string {
  const projectIcon = project?.icon;
  if (projectIcon && /^(https?:)?\//.test(projectIcon)) return escapeHtml(projectIcon);
  const glyph = projectIcon || 'y';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#111113"/><text x="16" y="22" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="#fff">${escapeHtml(glyph)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function layout({ title, body, user = null, projects = [], project = null, notice: pageNotice = null, bare = false }: LayoutOpts): string {
  const shell = bare
    ? `<main class="mx-auto max-w-md px-6 py-16 flex flex-col gap-6">
        ${pageNotice ? notice(pageNotice) : ''}
        ${body}
      </main>`
    : `<div class="flex min-h-screen">
        ${sidebar({ user: user!, projects, project })}
        <main class="@container flex-1 min-w-0 px-8 py-8">
          <div class="w-full max-w-6xl flex flex-col gap-5">
            ${pageNotice ? notice(pageNotice) : ''}
            ${body}
          </div>
        </main>
      </div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · ${APP_NAME}</title>
  <link rel="icon" href="${favicon(project)}">
  <link rel="stylesheet" href="/public/admin.css?v=${ADMIN_CSS_V}">
</head>
<body class="min-h-screen bg-background text-foreground">
  ${shell}
  <script type="module">import { marked } from '/public/vendor/marked.esm.js?v=${MARKED_V}'; window.marked = marked;</script>
  <script src="/public/admin.js?v=${ADMIN_JS_V}"></script>
</body>
</html>`;
}

const SIDEBAR_LINK = 'flex items-center gap-2 px-3 py-1.5 text-sm text-sidebar-foreground no-underline hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground aria-[current=page]:font-medium';

function sidebar({ user, projects, project }: {
  user: { email: string }; projects: { slug: string; name: string; icon?: string }[]; project: { slug: string; name: string; icon?: string } | null;
}): string {
  const options = [
    project ? '' : `<option value="" disabled selected hidden>Select a project</option>`,
    ...projects.map(
      (p) =>
        `<option value="${escapeHtml(p.slug)}"${project && p.slug === project.slug ? ' selected' : ''}>${p.icon && !/^(https?:)?\//.test(p.icon) ? `${escapeHtml(p.icon)} ` : ''}${escapeHtml(p.name)}</option>`,
    ),
  ].join('');

  const projectNav = project
    ? `<div class="flex flex-col gap-0.5 mt-4">
        <span class="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-2">${projectAvatar(project, 'size-5 text-[10px]')}${escapeHtml(project.name)}</span>
        <a data-nav class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/collections">${icon('document')}Content</a>
        <a data-nav class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/media">${icon('gallery')}Media</a>
        <a data-nav class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/api-keys">${icon('key')}API keys</a>
        <a data-nav class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}/transfer">${icon('transfer')}Transfer</a>
        <a data-nav class="${SIDEBAR_LINK}" href="/admin/projects/${project.slug}">${icon('settings')}Project settings</a>
      </div>`
    : '';

  return `<aside class="w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col p-3 sticky top-0 h-screen">
    <a class="px-3 py-2 font-bold text-sidebar-foreground no-underline" href="/admin/projects">${APP_NAME}</a>
    <select id="project-switcher" class="${SELECT_CLASS} bg-sidebar mb-1" title="Switch project">${options}</select>
    ${projectNav}
    <div class="mt-auto flex flex-col gap-0.5 border-t border-sidebar-border pt-3">
      <span class="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Instance</span>
      <a data-nav class="${SIDEBAR_LINK}" href="/admin/projects">${icon('folder')}Projects</a>
      <a data-nav class="${SIDEBAR_LINK}" href="/admin/settings">${icon('settings')}Global settings</a>
      <a data-nav class="${SIDEBAR_LINK}" href="/account">${icon('user')}Account</a>
      <div class="mt-2 border-t border-sidebar-border pt-3 px-3 flex flex-col gap-2">
        <span class="text-xs text-muted-foreground truncate">${escapeHtml(user.email)}</span>
        <span class="text-xs text-muted-foreground">${APP_NAME} v${APP_VERSION}</span>
        <form method="post" action="/logout">${button({ label: 'Log out', variant: 'outline', small: true })}</form>
      </div>
    </div>
  </aside>`;
}

// ---- Auth pages -----------------------------------------------------------

export function setupPage({ error }: { error?: string } = {}): string {
  return layout({
    title: `Set up ${APP_NAME}`,
    bare: true,
    body: `
      <h1 class="text-2xl font-semibold">Set up ${APP_NAME}</h1>
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

export function loginPage({ error, passkeys = false, google = false, password = true }: {
  error?: string; passkeys?: boolean; google?: boolean; password?: boolean;
} = {}): string {
  const alternatives =
    passkeys || google
      ? `<div class="flex flex-col gap-2">
          ${passkeys ? `<button type="button" data-passkey-login class="${BUTTON_BASE} ${BUTTON_VARIANTS.outline} h-9 px-4 py-2 w-full">Use a passkey</button>` : ''}
          ${google ? `<a href="/auth/google" class="${BUTTON_BASE} ${BUTTON_VARIANTS.outline} h-9 px-4 py-2 w-full no-underline">Continue with Google</a>` : ''}
          <p data-passkey-error class="text-sm text-destructive" hidden></p>
        </div>`
      : '';
  const passwordForm = password
    ? card({
        action: '/login',
        children: `
        ${field({ label: 'Email', name: 'email', type: 'email', required: true, autofocus: true })}
        ${field({ label: 'Password', name: 'password', type: 'password', required: true })}
        ${button({ label: 'Log in' })}
      `,
      })
    : '<p class="text-sm text-muted-foreground">Password login is turned off for this instance. Use a passkey or Google below.</p>';
  return layout({
    title: 'Log in',
    bare: true,
    body: `
      <h1 class="text-2xl font-semibold">Log in</h1>
      ${error ? notice({ type: 'error', message: error }) : ''}
      ${passwordForm}
      ${alternatives}
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

export function accountPage({ user, projects, credentials = [], google = false, passwordLogin = true, notice: pageNotice }: any): string {
  const canDisable = credentials.length > 0 || google;
  const loginMethods = `<div class="${CARD_CLASS} p-4 flex flex-col gap-3 max-w-md">
    <h2 class="text-sm font-semibold">Login methods</h2>
    <ul class="list-none p-0 m-0 flex flex-col gap-1 text-sm">
      <li>Passkeys: ${credentials.length ? `<strong>${credentials.length} registered</strong>` : '<span class="text-muted-foreground">none</span>'}</li>
      <li>Google: ${google ? '<strong>configured</strong>' : '<span class="text-muted-foreground">not configured (set google_client_id and google_client_secret in Global settings)</span>'}</li>
      <li>Email + password: ${passwordLogin ? '<strong>enabled</strong>' : '<span class="text-muted-foreground">disabled</span>'}</li>
    </ul>
    <form method="post" action="/account/login-methods" class="flex flex-col gap-3">
      <input type="hidden" name="password_login" value="${passwordLogin ? 'off' : 'on'}">
      <p class="text-xs text-muted-foreground m-0">${passwordLogin
        ? 'Turning password login off removes the brute-force surface: only passkeys and Google can sign in. It is only allowed while at least one of those works. Recovery: set FORCE_PASSWORD_RESET=1 in .env and restart, password login comes back for a reset.'
        : 'Password login is off. The login page only offers passkeys and Google.'}</p>
      ${passwordLogin
        ? (canDisable
          ? button({ label: 'Disable password login', variant: 'outline' })
          : '<p class="text-xs text-muted-foreground m-0">Add a passkey or configure Google first, then this can be disabled.</p>')
        : button({ label: 'Re-enable password login', variant: 'outline' })}
    </form>
  </div>`;
  const passkeyRows = credentials
    .map(
      (c: any) => `<tr class="border-b border-border">
        <td class="p-2 text-sm">${escapeHtml(c.name)}</td>
        <td class="p-2 text-sm text-muted-foreground">${timeAgo(c.created_at)}</td>
        <td class="p-2 text-right">
          <form method="post" action="/account/passkeys/${c.id}/delete">
            ${button({ label: 'Remove', variant: 'ghost', small: true })}
          </form>
        </td>
      </tr>`,
    )
    .join('\n');

  return layout({
    title: 'Account',
    user,
    projects,
    notice: pageNotice,
    body: `
      ${pageHeader('Account')}
      <div class="${CARD_CLASS} p-4 flex flex-col gap-3">
        <h2 class="text-sm font-semibold">Passkeys</h2>
        <p class="text-sm text-muted-foreground">Sign in with your device instead of the password. Registered passkeys appear on the login page automatically.</p>
        ${tableCard(`<table class="w-full border-collapse">
          ${tableHead([{ label: 'Name' }, { label: 'Added' }, { label: '' }])}
          <tbody>${passkeyRows || '<tr><td colspan="3" class="p-3 text-muted-foreground italic">No passkeys yet.</td></tr>'}</tbody>
        </table>`)}
        <div class="flex items-center gap-3">
          <input type="text" data-passkey-name placeholder="Name (e.g. MacBook, phone)" class="${INPUT_CLASS} h-8 w-56 text-sm" />
          <button type="button" data-passkey-register class="${BUTTON_BASE} ${BUTTON_VARIANTS.outline} h-8 px-3 text-sm">Add a passkey</button>
          <p data-passkey-error class="text-sm text-destructive" hidden></p>
        </div>
      </div>
      ${loginMethods}
      <form method="post" action="/account/password" class="${CARD_CLASS} p-4 flex flex-col gap-3 max-w-md">
        <h2 class="text-sm font-semibold">Change password</h2>
        ${field({ label: 'Current password', name: 'current_password', type: 'password', required: true })}
        ${field({ label: 'New password', name: 'password', type: 'password', required: true, minlength: 8 })}
        ${field({ label: 'Confirm new password', name: 'password_confirm', type: 'password', required: true, minlength: 8 })}
        <div>${button({ label: 'Change password' })}</div>
      </form>
    `,
  });
}

// ---- Projects -------------------------------------------------------------

// Identifiable per-project mark: uploaded logo URL > emoji > auto initials
// avatar with a hue derived from the slug (stable, no config needed).
export function projectAvatar(p: any, size = 'size-7 text-xs'): string {
  const icon = (p.icon || '').trim();
  if (/^(https?:)?\//.test(icon)) {
    return `<img src="${escapeHtml(icon)}" alt="" class="${size} object-cover shrink-0">`;
  }
  if (icon) {
    return `<span class="${size} flex items-center justify-center shrink-0 text-base">${escapeHtml(icon)}</span>`;
  }
  let hash = 0;
  for (const c of p.slug) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  const initials = p.name.split(/\s+/).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
  return `<span class="${size} flex items-center justify-center shrink-0 font-semibold text-white" style="background: hsl(${hash} 55% 45%)">${escapeHtml(initials)}</span>`;
}

export function projectListPage({ user, projects, notice: pageNotice }: any): string {
  const rows = projects
    .map(
      (p: any) => `<tr class="border-b border-border">
        <td class="p-3 text-left"><a class="flex items-center gap-2 text-foreground font-medium no-underline hover:text-link" href="/admin/projects/${encodeURIComponent(p.slug)}/collections">${projectAvatar(p)}${escapeHtml(p.name)}</a></td>
        <td class="p-3 text-left"><code class="text-sm text-muted-foreground">${escapeHtml(p.slug)}</code></td>
        <td class="p-3 text-left @max-lg:hidden text-sm text-muted-foreground">${timeAgo(p.created_at)}</td>
        <td class="p-3 text-right">
          <a class="text-link text-sm hover:underline" href="/admin/projects/${encodeURIComponent(p.slug)}">Settings</a>
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

export function projectDetailPage({ user, projects, project, settingKeys, globalSettingKeys = [], editKey = '', storages = [], mediaStorage = '', webhookUrl = '', hasWebhookSecret = false, notice: pageNotice }: any): string {
  const settingsBase = `/admin/projects/${encodeURIComponent(project.slug)}/settings`;
  const editing = editKey && settingKeys.some((s: any) => s.key === editKey);
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
            ${field({ label: 'Icon (an emoji, or paste an image URL from Media)', name: 'icon', value: project.icon || '', placeholder: '🚀 or /media/...' })}
            ${button({ label: 'Save' })}
          `,
          })}

          ${sectionHeading('Media storage')}
          <p class="text-sm text-muted-foreground">Where this project's uploads go. Shared storages are configured once in Global settings and reusable by every project.</p>
          ${card({
            action: `/admin/projects/${encodeURIComponent(project.slug)}/storage`,
            extraClass: '',
            children: `
            ${selectField({
              label: 'Storage',
              name: 'storage',
              options: [
                { value: 'local', label: 'Local disk (default)', selected: !mediaStorage || mediaStorage === 'local' },
                ...storages.map((s: string) => ({ value: s, label: `${s} (shared S3)`, selected: mediaStorage === s })),
              ],
            })}
            ${storages.length ? '' : '<p class="text-xs text-muted-foreground m-0">No shared storages yet. Add one under Global settings.</p>'}
            ${button({ label: 'Use this storage' })}
          `,
          })}

          ${sectionHeading('Publish webhook')}
          <p class="text-sm text-muted-foreground">Outbound webhook fired when published content changes, so static-site consumers can trigger rebuilds instead of polling.</p>
          ${card({
            action: `/admin/projects/${encodeURIComponent(project.slug)}/webhook`,
            extraClass: '',
            children: `
            ${field({
              label: 'Webhook URL',
              name: 'webhook_url',
              value: webhookUrl,
              placeholder: 'https://api.example.com/rebuild-hook',
              help: 'POSTed on publish, unpublish and delete of a published entry. Use it to trigger a static site rebuild.',
            })}
            ${field({
              label: 'Webhook secret',
              name: 'webhook_secret',
              type: 'password',
              autocomplete: 'off',
              help: (hasWebhookSecret ? 'Leave blank to keep existing secret. ' : '') + 'Optional. Requests carry X-Boring-Signature: sha256=HMAC-SHA256(body, secret).',
            })}
            ${button({ label: 'Save webhook' })}
          `,
          })}

          ${sectionHeading('Project secrets')}
          <p class="text-sm text-muted-foreground">Values are write-only and stored encrypted; only names and last-updated time are ever shown. Setting a key that already exists overrides its value.</p>
          ${secretsTable(settingKeys, settingsBase)}
          ${card({
            action: settingsBase,
            extraClass: '',
            children: `
            ${editing ? `<p class="text-sm font-medium m-0">Update <code>${escapeHtml(editKey)}</code></p>` : ''}
            ${field({ label: 'Name', name: 'key', value: editing ? editKey : '', required: true, placeholder: 'STRIPE_SECRET_KEY' })}
            ${field({ label: 'Value', name: 'value', type: 'password', required: true, autocomplete: 'off' })}
            ${button({ label: editing ? 'Update secret' : 'Add secret' })}
          `,
          })}

          ${globalSettingKeys.length ? `
          ${sectionHeading('Global secrets')}
          <p class="text-sm text-muted-foreground">Set once under Global settings, not shown per-project. Reusing one of these names above adds a separate project-scoped secret; whether your code prefers it over the global one depends on the lookup order that code uses.</p>
          <ul class="list-none p-0 m-0 flex flex-wrap gap-2">
            ${globalSettingKeys.map((s: any) => `<li><code class="text-sm bg-muted px-2 py-1">${escapeHtml(s.key)}</code></li>`).join('')}
          </ul>
          ` : ''}
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

export function globalSettingsPage({ user, projects, settingKeys, editKey = '', storages = [], storageEdit = null, notice: pageNotice }: any): string {
  const editing = editKey && settingKeys.some((s: any) => s.key === editKey);
  // storages: [{name, endpoint, bucket, key, region, public_url}] with the
  // secret never included. storageEdit pre-fills the form for one of them.
  const s = storageEdit || {};
  const editingStorage = !!storageEdit;
  const storageRows = storages
    .map(
      (st: any) => `<tr class="border-b border-border">
        <td class="p-3"><code class="text-sm">${escapeHtml(st.name)}</code></td>
        <td class="p-3 text-sm text-muted-foreground break-all">${escapeHtml(st.bucket)} @ ${escapeHtml(st.endpoint)}</td>
        <td class="p-3 text-sm text-muted-foreground">${escapeHtml(st.public_url || '')}</td>
        <td class="p-3 text-right whitespace-nowrap">
          <a href="/admin/settings?storage=${encodeURIComponent(st.name)}" class="text-link text-sm no-underline hover:underline mr-3">Edit</a>
          <form method="post" action="/admin/settings/storage/delete" class="inline" data-confirm="delete-secret">
            <input type="hidden" name="name" value="${escapeHtml(st.name)}">
            <button type="submit" class="text-destructive text-sm bg-transparent border-0 p-0 cursor-pointer hover:underline">Delete</button>
          </form>
        </td>
      </tr>`,
    )
    .join('\n');
  const storagesTable = tableCard(`<table class="w-full border-collapse">
    ${tableHead([{ label: 'Name' }, { label: 'Bucket' }, { label: 'Public URL' }, { label: '' }])}
    <tbody>${storageRows || '<tr><td colspan="4" class="p-3 text-muted-foreground italic">No storages yet.</td></tr>'}</tbody>
  </table>`);
  return layout({
    title: 'Settings',
    user,
    projects,
    notice: pageNotice,
    body: `
      <h1 class="text-2xl font-semibold">Global settings</h1>
      ${sectionHeading('Secrets')}
      <p class="text-sm text-muted-foreground">Values are write-only and stored encrypted; only names and last-updated time are ever shown. Available to every project. Setting a name that already exists overrides its value.</p>
      <div class="max-w-2xl">${secretsTable(settingKeys, '/admin/settings')}</div>
      <div class="grid gap-6 @3xl:grid-cols-2 items-start">
        ${card({
          action: '/admin/settings',
          extraClass: '',
          children: `
          ${editing ? `<p class="text-sm font-medium m-0">Update <code>${escapeHtml(editKey)}</code></p>` : ''}
          ${field({ label: 'Name', name: 'key', value: editing ? editKey : '', required: true, placeholder: 'STRIPE_SECRET_KEY' })}
          ${field({ label: 'Value', name: 'value', type: 'password', required: true, autocomplete: 'off' })}
          ${button({ label: editing ? 'Update secret' : 'Add secret' })}
        `,
        })}
      </div>

      ${sectionHeading('Shared S3 storages')}
      <p class="text-sm text-muted-foreground">Configure a bucket (R2, MinIO, S3) once; any project can select it as its media storage, and any storage stays usable for uploads and sync at any time. Only the secret key is write-only; everything else is visible and editable here.</p>
      <div class="max-w-3xl">${storagesTable}</div>
      ${card({
        action: '/admin/settings/storage',
        extraClass: 'max-w-2xl',
        children: `
        <h2 class="text-sm font-semibold m-0">${editingStorage ? `Edit storage <code>${escapeHtml(s.name)}</code>` : 'Add shared S3 storage'}</h2>
        ${editingStorage
          ? `<input type="hidden" name="name" value="${escapeHtml(s.name)}">`
          : field({ label: 'Name', name: 'name', required: true, placeholder: 'r2-main' })}
        ${field({ label: 'Endpoint', name: 'endpoint', required: true, value: s.endpoint || '', placeholder: 'https://<account>.r2.cloudflarestorage.com' })}
        ${field({ label: 'Bucket', name: 'bucket', required: true, value: s.bucket || '' })}
        ${field({ label: 'Access key', name: 'key', required: true, value: s.key || '', autocomplete: 'off', help: 'Object-level read and write on this one bucket is enough. Never use an account or admin credential. R2: create an API token with the "Object Read & Write" permission scoped to the bucket. AWS/MinIO: a key limited to s3:GetObject, s3:PutObject, s3:DeleteObject and s3:ListBucket on the bucket.' })}
        ${field({ label: 'Secret key', name: 'secret', type: 'password', required: !editingStorage, autocomplete: 'off', help: editingStorage ? 'Secret is set and never shown. Leave blank to keep it; paste a new one to re-roll.' : undefined })}
        ${field({ label: 'Region', name: 'region', value: s.region || '', placeholder: 'auto' })}
        ${field({ label: 'Public URL (custom domain, used in content links)', name: 'public_url', value: s.public_url || '', placeholder: 'https://cdn.example.com' })}
        ${checkbox({ name: 'skip_test', label: 'Save without testing (skip the write/list/delete probe)' })}
        ${button({ label: editingStorage ? 'Test and update storage' : 'Test and save storage' })}
        ${editingStorage ? `<a href="/admin/settings" class="text-sm text-muted-foreground no-underline hover:underline">Cancel edit</a>` : ''}
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
        <td class="p-3"><a class="text-foreground font-medium no-underline hover:text-link" href="/admin/projects/${project.slug}/collections/${c.slug}">${escapeHtml(c.name)}</a></td>
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

export function collectionPage({ user, projects, project, collection, entries, page = 1, totalPages = 1, q = '', status = '', fieldTypes, collections = [], fieldUsage = {}, notice: pageNotice }: any): string {
  const base = `/admin/projects/${project.slug}/collections/${collection.slug}`;
  const qs = (p: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (p > 1) params.set('page', String(p));
    const s = params.toString();
    return s ? `?${s}` : '';
  };

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
    const relationTargets = collections
      .map((c: any) => `<option value="${escapeHtml(c.slug)}"${c.slug === f.collection ? ' selected' : ''}>${escapeHtml(c.name)}</option>`)
      .join('');
    // Always rendered so switching a field to relation is one save, not two.
    const relationOpts = `<label class="flex flex-col gap-1 text-xs">
          <span class="font-medium text-muted-foreground">Target collection${f.type === 'relation' ? '' : ' (relation type only)'}</span>
          <select name="collection" class="${SELECT_CLASS} h-8">
            <option value="">Choose one&hellip;</option>
            ${relationTargets}
          </select>
        </label>
        <label class="flex items-center gap-2 text-xs font-medium text-muted-foreground self-end">
          <input type="checkbox" name="multiple" value="1"${f.multiple ? ' checked' : ''} class="size-3.5 accent-primary"> Allow multiple (relation)
        </label>`;
    return `<form method="post" action="${base}/fields/update" class="grid grid-cols-2 gap-3 border-b border-border bg-muted/50 px-4 py-4">
      <input type="hidden" name="field" value="${escapeHtml(f.name)}">
      ${opt(f, 'label', 'Label')}
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-medium text-muted-foreground">Type</span>
        <select name="type" class="${SELECT_CLASS} h-8">${typeSel}</select>
      </label>
      ${opt(f, 'help', 'Help text', { placeholder: 'Shown under the input' })}
      ${opt(f, 'placeholder', 'Placeholder')}
      ${f.type === 'boolean' || f.type === 'relation' ? '' : opt(f, 'default', 'Default value')}
      ${constraints}
      ${relationOpts}
      <label class="col-span-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input type="checkbox" name="required" value="1"${f.required ? ' checked' : ''} class="size-3.5 accent-primary"> Required
      </label>
      <label class="col-span-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <input type="checkbox" name="unique" value="1"${f.unique ? ' checked' : ''} class="size-3.5 accent-primary"> Unique (no two entries may share a value; enforced on save, API and MCP writes)
      </label>
      <div class="col-span-2">${button({ label: 'Save field', small: true })}</div>
    </form>`;
  };

  // Plain-language uniqueness read for a field's stored values.
  const uniqDesc = (u: any) => {
    if (!u || u.filled === 0) return 'no entries have a value';
    if (u.distinct === u.filled) return 'every value is unique';
    if (u.distinct === 1) return 'all share one value';
    return `${u.distinct} distinct values`;
  };

  const fieldRows = collection.fields
    .map(
      (f: any) => {
        const u = fieldUsage[f.name] || { total: 0, filled: 0, distinct: 0 };
        const delMsg = `Delete field "${f.label}" (${f.name})? ${u.filled} of ${u.total} entries have a value (${uniqDesc(u)}). This cannot be undone and is not stored as a revision.`;
        return `<div draggable="true" data-field="${escapeHtml(f.name)}" class="bg-card">
        <div class="flex items-center gap-3 border-b border-border px-3 py-2 text-sm cursor-grab">
          <span class="text-muted-foreground shrink-0" aria-hidden="true">${gripIcon}</span>
          <span class="font-medium">${escapeHtml(f.label)}</span>
          <code class="text-muted-foreground">${escapeHtml(f.name)}</code>
          <span class="text-muted-foreground">${escapeHtml(f.type)}</span>
          ${f.required ? '<span class="text-xs font-medium text-primary-foreground bg-primary px-1.5 py-0.5">required</span>' : ''}
          ${f.unique ? '<span class="text-xs font-medium text-primary-foreground bg-primary px-1.5 py-0.5">unique</span>' : ''}
          <span class="text-xs text-muted-foreground" title="${escapeHtml(uniqDesc(u))}">${u.filled}/${u.total} filled</span>
          <button type="button" data-field-edit class="ml-auto text-xs text-link hover:underline cursor-pointer bg-transparent border-0 p-0">Edit</button>
          <form method="post" action="${base}/fields/remove" data-confirm="delete-field" data-confirm-message="${escapeHtml(delMsg)}">
            <input type="hidden" name="field" value="${escapeHtml(f.name)}">
            ${button({ label: 'Remove', variant: 'ghost', small: true })}
          </form>
        </div>
        <div data-field-editor hidden>${fieldEditor(f)}</div>
      </div>`;
      },
    )
    .join('\n');

  // The system writes these on every entry; showing them here stops people
  // from adding redundant custom copies (their names are reserved anyway).
  const builtinFieldRows = [
    { name: 'slug', type: 'text', note: 'public id in API URLs, editable on each entry' },
    { name: 'updated_at', type: 'datetime', note: 'set automatically on save' },
    { name: 'published_at', type: 'datetime', note: 'set automatically on publish' },
  ]
    .map(
      (f) => `<div class="flex items-center gap-3 border-b border-border last:border-b-0 px-3 py-2 text-sm">
        <code class="text-muted-foreground">${f.name}</code>
        <span class="text-muted-foreground">${f.type}</span>
        <span class="text-xs text-muted-foreground">${f.note}</span>
        <span class="ml-auto text-xs font-medium text-muted-foreground bg-muted px-1.5 py-0.5">built-in</span>
      </div>`,
    )
    .join('\n');

  const initialOrder = collection.fields.map((f: any) => f.name).join(',');

  const entryRows = entries
    .map(
      (e: any) => `<tr class="border-b border-border">
        <td class="p-3"><a class="text-foreground font-medium no-underline hover:text-link" href="${base}/${e.slug}">${escapeHtml(entryLabel(e, collection))}</a></td>
        <td class="p-3 @max-lg:hidden"><code class="text-xs text-muted-foreground">${escapeHtml(e.slug)}</code></td>
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

      <form method="get" action="${base}" class="flex flex-wrap items-end gap-3 mb-4">
        <label class="flex flex-col gap-1.5 text-sm flex-1 min-w-48">
          <span class="font-medium text-foreground">Search</span>
          <input type="search" name="q" value="${escapeHtml(q)}" placeholder="Search entries&hellip;" class="${INPUT_CLASS}">
        </label>
        <label class="flex flex-col gap-1.5 text-sm">
          <span class="font-medium text-foreground">Status</span>
          <select name="status" class="${SELECT_CLASS}">
            <option value=""${status ? '' : ' selected'}>All</option>
            <option value="draft"${status === 'draft' ? ' selected' : ''}>Draft</option>
            <option value="published"${status === 'published' ? ' selected' : ''}>Published</option>
          </select>
        </label>
        ${button({ label: 'Filter', variant: 'outline' })}
        ${q || status ? `<a href="${base}" class="text-sm text-muted-foreground no-underline hover:underline self-center">Clear</a>` : ''}
      </form>

      ${tableCard(`<table class="w-full border-collapse">
        ${tableHead([{ label: 'Entry' }, { label: 'Slug', extra: '@max-lg:hidden' }, { label: 'Status' }, { label: 'Updated', extra: '@max-lg:hidden' }])}
        <tbody>${entryRows || `<tr><td colspan="4" class="p-3 text-muted-foreground italic">${q || status ? 'No entries match.' : 'No entries yet.'}</td></tr>`}</tbody>
      </table>`)}
      ${totalPages > 1 ? `<div class="flex items-center justify-between gap-4 mt-3 text-sm text-muted-foreground">
        <span>Page ${page} of ${totalPages}</span>
        <div class="flex gap-2">
          ${page > 1 ? `<a class="text-link no-underline hover:underline" href="${base}${qs(page - 1)}">&larr; Prev</a>` : ''}
          ${page < totalPages ? `<a class="text-link no-underline hover:underline" href="${base}${qs(page + 1)}">Next &rarr;</a>` : ''}
        </div>
      </div>` : ''}

      <div class="flex flex-col gap-3 mt-16 max-w-2xl">
        <div class="flex items-center justify-between gap-4">
          ${sectionHeading('Fields')}
          ${addPopover({
            label: 'Add field',
            action: `${base}/fields/add`,
            children: `
            ${field({ label: 'Field label', name: 'label', required: true, placeholder: 'Body' })}
            ${field({ label: 'Field id', name: 'name', placeholder: 'auto from label', help: 'The data key in the API. Leave empty to derive it from the label.' })}
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium text-foreground">Type</span>
              <select name="type" class="${SELECT_CLASS}">${typeOptions}</select>
            </label>
            <label class="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" name="required" value="1" class="size-3.5 accent-primary"> Required
            </label>
            <label class="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" name="unique" value="1" class="size-3.5 accent-primary"> Unique
            </label>
            ${button({ label: 'Add field' })}
          `,
          })}
        </div>
        <p class="text-sm text-muted-foreground">Drag to reorder. The first field's value is the entry label in lists; entries with no values show their id.</p>
        <div class="border border-border bg-card shadow-xs">
          ${builtinFieldRows}
        </div>
        <div class="border border-border bg-card shadow-xs" data-field-list>
          ${fieldRows || '<p class="p-3 text-muted-foreground italic text-sm m-0">No fields yet. Add a markdown body or more with the + button.</p>'}
          <form method="post" action="${base}/fields/reorder" data-reorder-form data-initial="${escapeHtml(initialOrder)}" hidden>
            <input type="hidden" name="order" value="">
          </form>
        </div>
      </div>

      <div class="flex flex-col gap-3 mt-10 max-w-2xl">
        ${sectionHeading('Revisions')}
        <form method="post" action="${base}/revisions" class="flex flex-wrap items-end gap-3">
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="font-medium text-foreground">Keep per entry</span>
            <select name="revisions_keep" class="${SELECT_CLASS}">
              <option value=""${collection.revisions_keep == null ? ' selected' : ''}>Default (keep ${REVISIONS_KEEP})</option>
              <option value="0"${collection.revisions_keep === 0 ? ' selected' : ''}>Off (no revisions)</option>
              <option value="5"${collection.revisions_keep === 5 ? ' selected' : ''}>Keep 5</option>
              <option value="20"${collection.revisions_keep === 20 ? ' selected' : ''}>Keep 20</option>
            </select>
          </label>
          ${button({ label: 'Save', variant: 'outline' })}
        </form>
        <p class="text-sm text-muted-foreground">Edits store field-level revisions per entry; anything older than 15 days is deleted automatically. Turn revisions off for collections that agents rewrite constantly.</p>
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
  return `<span class="inline-flex items-center border px-2 py-0.5 text-xs font-medium ${cls}">${escapeHtml(status)}</span>`;
}

// ---- Entry editor ---------------------------------------------------------

// Content-facing media URL: the storage's custom domain when set, the app
// serve route otherwise. Never couples S3 URLs to the project slug.
function mediaUrl(projectSlug: string, key: string, publicBase: string | null = null): string {
  return publicBase ? `${publicBase.replace(/\/+$/, '')}/${key}` : `/media/${projectSlug}/${key}`;
}

function fieldInput(f: any, value: unknown, { media = [], projectSlug = '', publicBase = null, relationOptions = {} }: any = {}): string {
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
          <button type="button" data-preview-toggle class="text-xs text-link hover:underline cursor-pointer bg-transparent border-0 p-0">Preview</button>
        </div>
        <textarea name="field_${f.name}" class="${TEXTAREA_CLASS}" rows="14" ${constraintAttrs}>${escapeHtml(v)}</textarea>
        ${help}
        <div data-preview class="typeset border border-border bg-card p-4 hidden"></div>
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
          const url = m.url ?? mediaUrl(projectSlug, m.key, publicBase);
          const thumb = m.variants?.thumb ? url.replace(m.key, m.variants.thumb) : url;
          return `<button type="button" data-image-set="${escapeHtml(url)}" data-media-name="${escapeHtml(`${m.filename} ${m.folder || ''}`.toLowerCase())}" class="border border-border bg-card p-0 cursor-pointer hover:border-primary" title="${escapeHtml(m.filename)}">
            <img src="${thumb}" alt="${escapeHtml(m.filename)}" loading="lazy" class="h-20 w-full object-cover">
          </button>`;
        })
        .join('');
      return `<div class="flex flex-col gap-1.5 text-sm" data-image-field>
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        <div class="flex gap-2">
          <input type="text" name="field_${f.name}" value="${escapeHtml(v)}" class="${INPUT_CLASS}" ${constraintAttrs}>
          ${popover({
            summary: 'Browse',
            variant: 'outline',
            wrapClass: 'shrink-0',
            panelClass: 'w-96 max-h-80 overflow-y-auto p-3 flex flex-col gap-2',
            children: `
              <input type="search" placeholder="Search images" data-media-search class="${INPUT_CLASS}">
              ${images.length ? `<div class="grid grid-cols-3 gap-2">${pickerCards}</div>` : '<p class="text-xs text-muted-foreground m-0">No images in the media library yet.</p>'}
              <label class="text-xs text-muted-foreground cursor-pointer border-t border-border pt-2">Or upload a new image:
                <input type="file" accept="image/*" data-image-upload="/admin/projects/${escapeHtml(projectSlug)}/media" class="block mt-1 text-xs">
              </label>
            `,
          })}
        </div>
        <img data-image-preview src="${escapeHtml(v)}" alt="" class="max-h-40 w-fit border border-border${v ? '' : ' hidden'}">
        ${help}
      </div>`;
    }
    case 'relation': {
      const opts = relationOptions[f.name] || [];
      const selected = new Set(Array.isArray(v) ? v : v ? [v] : []);
      const optionTags = opts
        .map((o: any) => `<option value="${escapeHtml(o.slug)}"${selected.has(o.slug) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`)
        .join('');
      return `<label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        <select name="field_${f.name}"${f.multiple ? ' multiple size="6"' : ''} class="${SELECT_CLASS}${f.multiple ? ' h-auto' : ''}"${f.required ? ' required' : ''}>
          ${f.multiple ? '' : '<option value="">&mdash;</option>'}
          ${optionTags || '<option value="" disabled>No entries in the target collection yet</option>'}
        </select>
        ${help}
      </label>`;
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
    default: {
      // Plain text fields sometimes hold an image path (e.g. a "cover" field
      // not modeled as the richer `image` type): show a small preview so
      // editing an existing entry doesn't require leaving the page to check it.
      const looksLikeImage = typeof v === 'string' && /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(v);
      return `<label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-foreground">${escapeHtml(f.label)}</span>
        <input type="text" name="field_${f.name}" value="${escapeHtml(v)}" class="${INPUT_CLASS}" ${constraintAttrs}>
        ${looksLikeImage ? `<img src="${escapeHtml(v)}" alt="" loading="lazy" class="h-16 w-auto object-cover border border-border">` : ''}
        ${help}
      </label>`;
    }
  }
}

export function entryEditorPage({ user, projects, project, collection, entry, revisions = [], media = [], publicBase = null, relationOptions = {}, draft, notice: pageNotice }: any): string {
  const base = `/admin/projects/${project.slug}/collections/${collection.slug}`;
  const isNew = !entry;
  const action = isNew ? `${base}/new` : `${base}/${entry.slug}`;
  // draft = rejected submission values re-rendered so nothing typed is lost.
  const data = entry?.data ?? draft ?? {};
  const blank = isNew && !draft;

  const fieldInputs = collection.fields
    .map((f: any) => {
      // A user field literally named "slug" shadows the native slug in the
      // API; make the relationship visible instead of leaving it mysterious.
      const withHelp = f.name === 'slug' && !f.help && entry
        ? { ...f, help: `Native entry slug is "${entry.slug}". Leave this empty to use it in the API response; a value here overrides it.` }
        : f;
      return fieldInput(withHelp, blank ? undefined : data[f.name] ?? (f.type === 'relation' && f.multiple ? [] : ''), { media, projectSlug: project.slug, publicBase, relationOptions });
    })
    .join('\n');

  // Show what each revision changed, from-value to to-value, so a revert is
  // deliberate. Deltas store the PREVIOUS value; the resulting ("to") value
  // is reconstructed by walking newest-first from the current draft state.
  // A single changed value, rendered as a scrollable block so long diffs
  // stay readable inside the modal instead of overflowing the sidebar.
  const fmtVal = (v: any, tone: string) => {
    if (v === undefined || v === null || v === '') return `<div class="text-xs italic text-muted-foreground px-2 py-1.5 border border-border">(empty)</div>`;
    const s = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    const shown = s.length > 4000 ? `${s.slice(0, 4000)}\n…(${s.length - 4000} more characters)` : s;
    return `<pre class="text-xs px-2 py-1.5 border border-border max-h-64 overflow-auto whitespace-pre-wrap break-all m-0 ${tone}">${escapeHtml(shown)}</pre>`;
  };
  let after: Record<string, any> = entry ? { ...entry.data } : {};
  const revisionRows = revisions
    .map((r: any) => {
      const rows = Object.entries(r.changed)
        .filter(([k]) => k !== '__title')
        .map(([field, before]) => `<div class="flex flex-col gap-1">
            <code class="text-xs font-medium">${escapeHtml(field)}</code>
            <span class="text-xs text-muted-foreground">Before</span>
            ${fmtVal(before, 'text-destructive')}
            <span class="text-xs text-muted-foreground">After</span>
            ${fmtVal(after[field], 'text-foreground')}
          </div>`)
        .join('');
      // Step the after-state back to before this revision for older entries.
      const next = { ...after };
      for (const [field, before] of Object.entries(r.changed)) {
        if (field === '__title') continue;
        if (before === null || before === undefined) delete next[field];
        else next[field] = before;
      }
      after = next;
      const fields = Object.keys(r.changed).map((k) => (k === '__title' ? 'title' : k)).join(', ');
      const dlgId = `revdiff-${r.id}`;
      return `<li class="flex items-center justify-between gap-2 py-1.5 border-b border-border text-sm">
        <span class="text-muted-foreground min-w-0 truncate">${timeAgo(r.created_at)} · ${escapeHtml(fields)}</span>
        <button type="button" data-open-dialog="${dlgId}" class="shrink-0 text-xs text-link hover:underline cursor-pointer bg-transparent border-0 p-0">Diff</button>
        <dialog id="${dlgId}" class="w-[min(90vw,640px)] max-h-[85vh] p-0 border border-border bg-card text-card-foreground shadow-lg backdrop:bg-black/50">
          <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sticky top-0 bg-card">
            <span class="text-sm font-medium">Revision · ${timeAgo(r.created_at)}</span>
            <button type="button" data-close-dialog class="text-sm text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-0 p-0">Close</button>
          </div>
          <div class="flex flex-col gap-4 px-4 py-4 overflow-auto">
            ${rows || '<p class="text-sm text-muted-foreground italic">No field changes recorded.</p>'}
          </div>
          <div class="border-t border-border px-4 py-3 flex justify-end sticky bottom-0 bg-card">
            <form method="post" action="${base}/${entry.slug}/revert">
              <input type="hidden" name="revision_id" value="${r.id}">
              ${button({ label: 'Revert to before this', variant: 'outline', small: true })}
            </form>
          </div>
        </dialog>
      </li>`;
    })
    .join('\n');

  // What the API serves (or would serve after publish) for this entry, so
  // the editor never has to guess what a consumer sees.
  let apiPreviewCard = '';
  let dirty = false; // published entry whose draft differs from what is live
  if (!isNew) {
    const next: Record<string, any> = { published_at: isoUtc(entry.published_at), slug: entry.slug, ...entry.data, updated_at: isoUtc(entry.updated_at) };
    if (!next.slug) next.slug = entry.slug;
    const nextJson = JSON.stringify(next, null, 2);
    let liveJson = null;
    if (entry.status === 'published' && entry.published_data) {
      const live: Record<string, any> = { published_at: isoUtc(entry.published_at), ...entry.published_data, updated_at: isoUtc(entry.updated_at) };
      if (!live.slug) live.slug = entry.slug;
      liveJson = JSON.stringify(live, null, 2);
    }
    dirty = !!(liveJson && liveJson !== nextJson);
    const endpoint = `/api/v1/${project.slug}/${collection.slug}/${entry.slug}`;
    const blocks = liveJson && liveJson !== nextJson
      ? `<span class="text-xs font-medium">Live now</span>${preBlock(liveJson)}
         <span class="text-xs font-medium">After next publish</span>${preBlock(nextJson)}`
      : liveJson
        ? preBlock(liveJson)
        : `<span class="text-xs text-muted-foreground">Not published yet; this is what publish would serve.</span>${preBlock(nextJson)}`;
    apiPreviewCard = `<div class="${CARD_CLASS}">
      <span class="text-sm font-medium">API response</span>
      <code class="text-xs break-all">${escapeHtml(endpoint)}</code>
      ${blocks}
    </div>`;
  }

  const sidePanel = isNew
    ? ''
    : `<div class="flex flex-col gap-4">
        <div class="${CARD_CLASS}">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium">Status</span>
            ${statusBadge(entry.status)}
          </div>
          <p class="text-xs text-muted-foreground">ID: <code>${entry.id}</code><br>Updated: ${timeAgo(entry.updated_at)}${entry.published_at ? `<br>Published: ${timeAgo(entry.published_at)}` : ''}</p>
          ${dirty ? '<p class="text-xs font-medium text-primary">Draft has changes that are not live yet. Republish to push them to the API.</p>' : ''}
          <div class="flex gap-2 flex-wrap">
            ${entry.status === 'published'
              ? `${dirty ? `<form method="post" action="${base}/${entry.slug}/publish">${button({ label: 'Republish' })}</form>` : ''}<form method="post" action="${base}/${entry.slug}/unpublish">${button({ label: 'Unpublish', variant: 'outline' })}</form>`
              : `<form method="post" action="${base}/${entry.slug}/publish">${button({ label: 'Publish' })}</form>`}
            <form method="post" action="${base}/${entry.slug}/delete" data-confirm="delete-entry">${button({ label: 'Delete', variant: 'destructive' })}</form>
          </div>
        </div>
        ${apiPreviewCard}
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
      <p class="text-sm"><a class="text-link hover:underline" href="${base}">&larr; ${escapeHtml(collection.name)}</a></p>
      <div class="grid gap-8 @4xl:grid-cols-[minmax(0,1fr)_320px] items-start">
        <form method="post" action="${action}" class="flex flex-col gap-5 min-w-0">
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="font-medium text-foreground">Slug</span>
            <input type="text" name="entry_slug" value="${escapeHtml(entry?.slug ?? '')}" placeholder="auto (random id)" class="${INPUT_CLASS}">
            <span class="text-xs text-muted-foreground">${isNew ? 'Public id in the API URL. Leave empty for a generated id.' : 'Public id in the API URL. Changing it changes this entry’s API URL, so update anything linking to it.'}</span>
          </label>
          ${fieldInputs || '<p class="text-sm text-muted-foreground">This collection has no fields yet. Add fields on the collection page.</p>'}
          ${button({ label: isNew ? 'Create entry' : 'Save changes' })}
        </form>
        ${sidePanel}
      </div>
    `,
  });
}

// ---- API keys -------------------------------------------------------------

function mcpConfig(origin: string, slug: string, key: string): string {
  return JSON.stringify({
    mcpServers: {
      [slug]: {
        type: 'http',
        url: `${origin}/mcp/${slug}`,
        headers: { Authorization: `Bearer ${key}` },
      },
    },
  }, null, 2);
}

// On-page REST reference: what the API serves, every endpoint, and what a
// request needs. Uses the live origin and the project's real collections.
function apiDocs(origin: string, slug: string, collections: any[]): string {
  const listUrl = (c: string) => `${origin}/api/v1/${slug}/${c}`;
  const endpointRows = [
    { method: 'GET', path: `/api/v1/${slug}/&lt;collection&gt;`, desc: 'List published entries. Query: <code>limit</code> (default 50), <code>offset</code>, <code>updated_since</code> (ISO 8601 UTC, only entries changed after it).' },
    { method: 'GET', path: `/api/v1/${slug}/&lt;collection&gt;/&lt;entry-id&gt;`, desc: 'One published entry by its id.' },
    { method: 'GET', path: `/api/v1/${slug}/schema`, desc: 'Full project schema: every collection with its complete field list and options.' },
    { method: 'GET', path: `/api/v1/${slug}/field-types`, desc: 'Field type introspection: value shapes and the options each type accepts.' },
    { method: 'POST', path: `/api/v1/${slug}/schema`, desc: 'Apply a schema document (write scope): collections matched by slug, created or updated, field lists replaced. <code>?delete_missing=1</code> also deletes collections absent from it.' },
    { method: 'POST', path: `/mcp/${slug}`, desc: 'MCP endpoint (JSON-RPC). Read tools with any key; write tools need write scope.' },
  ]
    .map((e) => `<tr class="border-b border-border">
      <td class="p-2 text-xs font-medium">${e.method}</td>
      <td class="p-2"><code class="text-xs break-all">${e.path}</code></td>
      <td class="p-2 text-sm text-muted-foreground min-w-40">${e.desc}</td>
    </tr>`)
    .join('');
  const collectionLinks = collections.length
    ? `<p class="text-sm text-muted-foreground m-0">This project's collections:</p>
      <ul class="list-none p-0 m-0 flex flex-col gap-1">
        ${collections.map((c: any) => `<li><code class="text-xs">${escapeHtml(listUrl(c.slug))}</code></li>`).join('')}
      </ul>`
    : '<p class="text-sm text-muted-foreground m-0">No collections yet. Each collection gets its own endpoint once created.</p>';
  return `<div class="${CARD_CLASS} p-4 flex flex-col gap-3">
    <h2 class="text-sm font-semibold">REST API</h2>
    <p class="text-sm text-muted-foreground m-0">Read-only JSON over HTTPS. It serves <strong>published entries only</strong>: drafts never appear, and publishing materializes a snapshot so reads are cheap. Every request needs a key from this page sent as <code>Authorization: Bearer yn_...</code>. Missing or wrong key: <code>401</code>. Unknown project or collection: <code>404</code>.</p>
    ${tableCard(`<table class="w-full border-collapse">
      ${tableHead([{ label: 'Method' }, { label: 'Endpoint' }, { label: 'What it does' }])}
      <tbody>${endpointRows}</tbody>
    </table>`)}
    ${collectionLinks}
    <p class="text-sm text-muted-foreground m-0">Responses carry an <code>ETag</code> tied to the project's content version; it changes only when something is published or unpublished. Send it back as <code>If-None-Match</code> to get a free <code>304</code>, so repeated static-site builds cost nothing between publishes.</p>
    ${preBlock(`curl -H "Authorization: Bearer yn_..." \\\n  ${listUrl(collections[0]?.slug || '<collection>')}?limit=10`)}
  </div>`;
}

export function apiKeysPage({ user, projects, project, keys, createdKey, origin = '', collections = [], rateLimit = 60, notice: pageNotice }: any): string {
  const rows = keys
    .map(
      (k: any) => `<tr class="border-b border-border">
        <td class="p-2 text-sm">${escapeHtml(k.name)}</td>
        <td class="p-2 text-sm text-muted-foreground">${k.scope === 'write' ? 'read + write' : 'read'}</td>
        <td class="p-2 text-sm text-muted-foreground">${timeAgo(k.created_at)}</td>
        <td class="p-2 text-sm text-muted-foreground">${k.last_used_at ? timeAgo(k.last_used_at) : 'never'}</td>
        <td class="p-2 text-right">
          <form method="post" action="/admin/projects/${project.slug}/api-keys/${k.id}/revoke">
            ${button({ label: 'Revoke', variant: 'ghost-destructive', small: true })}
          </form>
        </td>
      </tr>`,
    )
    .join('\n');

  const createdConfig = createdKey ? mcpConfig(origin, project.slug, createdKey) : '';
  const createdBlock = createdKey
    ? `<div class="border border-emerald-600/30 bg-emerald-50 dark:bg-emerald-950/40 p-4 flex flex-col gap-2">
        <p class="text-sm font-medium text-emerald-700 dark:text-emerald-400">Key created. Copy it now, it will not be shown again.</p>
        <code class="text-sm break-all select-all">${escapeHtml(createdKey)}</code>
        <p class="text-sm text-emerald-700 dark:text-emerald-400 m-0">Ready-to-paste <code>.mcp.json</code> with this key:</p>
        ${preBlock(createdConfig)}
        <div><button type="button" data-copy="${escapeHtml(createdConfig)}" class="${BUTTON_BASE} ${BUTTON_VARIANTS.outline} h-7 px-2.5 text-xs">Copy config</button></div>
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
        ${selectField({
          label: 'Scope',
          name: 'scope',
          options: [
            { value: 'read', label: 'Read (published content)' },
            { value: 'write', label: 'Read + write (MCP editing tools)' },
          ],
        })}
        ${button({ label: 'Create key' })}
      `,
      }))}
      <p class="text-sm text-muted-foreground">Send as <code>Authorization: Bearer &lt;key&gt;</code>. Read scope covers published content at <code>/api/v1/${escapeHtml(project.slug)}/&lt;collection&gt;</code> and MCP read tools; write scope unlocks MCP editing tools.</p>
      ${createdBlock}
      ${tableCard(`<table class="w-full border-collapse">
        ${tableHead([{ label: 'Name' }, { label: 'Scope' }, { label: 'Created' }, { label: 'Last used' }, { label: '' }])}
        <tbody>${rows || '<tr><td colspan="5" class="p-3 text-muted-foreground italic">No API keys yet.</td></tr>'}</tbody>
      </table>`)}
      <div class="grid gap-6 @4xl:grid-cols-2 items-start">
        ${apiDocs(origin, project.slug, collections)}
        <div class="${CARD_CLASS} p-4 flex flex-col gap-2">
          <h2 class="text-sm font-semibold">MCP endpoint</h2>
          <p class="text-sm text-muted-foreground">Agents can read and edit this project over MCP at <code>${escapeHtml(origin)}/mcp/${escapeHtml(project.slug)}</code>. Claude Code <code>.mcp.json</code> (create a key above to get one with the key filled in):</p>
          ${preBlock(mcpConfig(origin, project.slug, 'yn_<key>'))}
          <form method="post" action="/admin/projects/${project.slug}/rate-limit" class="flex items-end gap-2 pt-1 border-t border-border mt-1">
            <label class="flex flex-col gap-1 text-xs flex-1">
              <span class="font-medium text-muted-foreground">Rate limit (requests/min per key)</span>
              <input type="number" name="rate_limit_per_min" value="${rateLimit}" min="1" class="${INPUT_CLASS} h-8">
            </label>
            ${button({ label: 'Save', small: true })}
          </form>
        </div>
      </div>
    `,
  });
}

// ---- Media library --------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// Preview URL: with a public base the wsrv.nl proxy resizes on the fly
// (no local copies, no server work); otherwise a pre-generated variant or
// the original served through the app.
function mediaPreviewUrl(projectSlug: string, m: any, publicBase: string | null, width = 320): string {
  // Pinned rows preview from where they actually live.
  const url = m.url ?? mediaUrl(projectSlug, m.key, publicBase);
  if (url.startsWith('http')) return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}`;
  const key = m.variants?.thumb || m.key;
  return `/media/${projectSlug}/${key}`;
}

export function mediaPage({ user, projects, project, media, publicBase = null, variantsMode = '', hasSharp = false, directUpload = false, usage = {}, staleCount = 0, oldCopyCount = 0, storages = [], storageLabels = [], defaultStorage = 'local', pathPrefix = '', subfolders = [], notice: pageNotice, report, syncReport }: any): string {
  const base = `/admin/projects/${project.slug}`;
  const storageSelect = (name: string, title: string) => storages.length > 1
    ? `<select name="${name}" class="${SELECT_CLASS}" title="${escapeHtml(title)}">${storages
        .map((s: any) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.label)}</option>`)
        .join('')}</select>`
    : '';
  const cards = media
    .map((m: any) => {
      const url = m.url ?? mediaUrl(project.slug, m.key, publicBase);
      const isImage = m.mime.startsWith('image/');
      const staleBadge = m.stale
        ? '<span class="inline-flex w-fit items-center bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground" title="Still served from the previous storage. Use Migrate media to move it.">old storage</span>'
        : '';
      const snippet = isImage ? `![${m.filename}](${url})` : `[${m.filename}](${url})`;
      const preview = isImage
        ? `<img src="${mediaPreviewUrl(project.slug, m, publicBase)}" alt="${escapeHtml(m.filename)}" loading="lazy" class="h-36 w-full object-cover bg-muted">`
        : `<div class="h-36 w-full bg-muted flex items-center justify-center text-xs font-medium uppercase tracking-wide text-muted-foreground">${escapeHtml(m.mime)}</div>`;
      const used = usage[m.key] || [];
      const usedBlock = used.length
        ? `<details class="relative" data-popover>
            <summary class="text-xs text-link cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden hover:underline">Used in ${used.length} ${used.length === 1 ? 'entry' : 'entries'}</summary>
            <div class="absolute left-0 top-full mt-1 z-10 w-64 border border-border bg-popover shadow-lg p-2 flex flex-col gap-1">
              ${used.map((u: any) => `<a class="text-xs text-link hover:underline truncate" href="${base}/collections/${u.collection}/${u.slug}">${escapeHtml(u.collectionName)}: ${u.slug.slice(0, 8)}…</a>`).join('')}
            </div>
          </details>`
        : '<span class="text-xs text-muted-foreground">Unused</span>';
      const storageBadge = m.storage && m.storage !== defaultStorage
        ? `<span class="inline-flex w-fit items-center bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground" title="Stored on ${escapeHtml(m.storage)}">${escapeHtml(m.storage)}</span>`
        : '';
      return `<div class="border border-border bg-card shadow-xs flex flex-col" data-media-item data-media-name="${escapeHtml(m.filename.toLowerCase())}" data-media-storage="${escapeHtml(m.storage || '')}">
        <a href="${url}" target="_blank" rel="noopener">${preview}</a>
        <div class="p-3 flex flex-col gap-2 text-sm">
          <span class="font-medium truncate" title="${escapeHtml(m.filename)}">${escapeHtml(m.filename)}</span>
          <span class="text-xs text-muted-foreground">${formatSize(m.size)}${m.width ? ` · ${m.width}×${m.height}` : ''}</span>
          ${staleBadge}${storageBadge}
          ${usedBlock}
          <div class="flex items-center gap-2">
            <button type="button" data-copy="${escapeHtml(snippet)}" class="${BUTTON_BASE} ${BUTTON_VARIANTS.outline} h-7 px-2.5 text-xs">Copy MD</button>
            <form method="post" action="${base}/media/${m.id}/delete" data-confirm="delete-media">
              ${button({ label: 'Delete', variant: 'ghost-destructive', small: true })}
            </form>
          </div>
        </div>
      </div>`;
    })
    .join('\n');

  const variantCheckbox = hasSharp && variantsMode !== 'off'
    ? checkbox({ name: 'variants', label: 'Generate resized variants (_320, _1024)', checked: variantsMode === 'on' })
    : '';

  const reportBlock = report ? preBlock(typeof report === 'string' ? report : JSON.stringify(report, null, 2)) : '';

  // Check-first sync report: what a sync would adopt (with previews for
  // images, by extension) and which rows lost their object. Adopting is the
  // explicit second step.
  let syncBlock = '';
  if (syncReport) {
    const thumb = (key: string) => {
      const isImage = /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(key);
      if (!isImage || !syncReport.publicBase) return '';
      return `<img src="https://wsrv.nl/?url=${encodeURIComponent(`${syncReport.publicBase}/${key}`)}&w=48&h=48&fit=cover" alt="" loading="lazy" class="h-8 w-8 object-cover bg-muted">`;
    };
    const fileLink = (key: string) => syncReport.publicBase
      ? `<a class="text-link hover:underline break-all" href="${escapeHtml(`${syncReport.publicBase}/${key}`)}" target="_blank" rel="noopener">${escapeHtml(key)}</a>`
      : `<span class="break-all">${escapeHtml(key)}</span>`;
    const adoptableRows = (syncReport.adoptable || [])
      .map((o: any) => `<li class="flex items-center gap-2 text-sm">${thumb(o.key)}${fileLink(o.key)}<span class="text-xs text-muted-foreground ml-auto whitespace-nowrap">${formatSize(o.size)}</span></li>`)
      .join('');
    const missingRows = (syncReport.missing || [])
      .map((k: string) => `<li class="text-sm text-destructive break-all">${escapeHtml(k)}</li>`)
      .join('');
    syncBlock = `<div class="${CARD_CLASS}">
      <span class="text-sm font-medium">Sync check: ${escapeHtml(syncReport.storage)} (${syncReport.total} objects)</span>
      ${adoptableRows
        ? `<span class="text-xs text-muted-foreground">${syncReport.apply ? 'Adopted' : 'Not in the media library yet'} (${(syncReport.adoptable || []).length}):</span>
          <ul class="list-none p-0 m-0 flex flex-col gap-1.5 max-h-80 overflow-y-auto">${adoptableRows}</ul>`
        : '<p class="text-sm text-muted-foreground m-0">Every file in the storage is already in the media library.</p>'}
      ${missingRows ? `<span class="text-xs text-muted-foreground">Rows whose file is gone from the storage (${syncReport.missing.length}):</span><ul class="list-none p-0 m-0 flex flex-col gap-1">${missingRows}</ul>` : ''}
      ${!syncReport.apply && adoptableRows
        ? `<form method="post" action="${base}/media/sync" class="flex items-center gap-2">
            <input type="hidden" name="storage" value="${escapeHtml(syncReport.storage)}">
            <input type="hidden" name="apply" value="1">
            ${button({ label: `Adopt ${(syncReport.adoptable || []).length} file${(syncReport.adoptable || []).length === 1 ? '' : 's'}` })}
          </form>`
        : ''}
    </div>`;
  }

  // Path drill-down over nested keys adopted from S3: folders come from the
  // key paths themselves, nothing is stored.
  const crumbs = pathPrefix ? pathPrefix.split('/') : [];
  const breadcrumb = crumbs.length
    ? `<nav class="flex items-center gap-1 text-sm flex-wrap">
        <a class="text-link hover:underline" href="${base}/media">All media</a>
        ${crumbs.map((seg: string, i: number) => {
          const target = crumbs.slice(0, i + 1).join('/');
          const last = i === crumbs.length - 1;
          return `<span class="text-muted-foreground">/</span>${last
            ? `<span class="font-medium">${escapeHtml(seg)}</span>`
            : `<a class="text-link hover:underline" href="${base}/media?path=${encodeURIComponent(target)}">${escapeHtml(seg)}</a>`}`;
        }).join('')}
      </nav>`
    : '';
  const folderCards = subfolders.length
    ? `<div class="grid gap-2 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-6">${subfolders
        .map((f: any) => {
          const target = pathPrefix ? `${pathPrefix}/${f.name}` : f.name;
          return `<a href="${base}/media?path=${encodeURIComponent(target)}" class="border border-border bg-card shadow-xs p-3 flex items-center gap-2 text-sm hover:border-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" class="shrink-0 text-muted-foreground"><g fill="currentColor"><path d="M22 14V11.7979C22 9.16554 22 7.84935 21.2305 6.99383C21.1598 6.91514 21.0849 6.84024 21.0062 6.76946C20.1506 6 18.8345 6 16.2021 6H15.8284C14.6747 6 14.0979 6 13.5604 5.84678C13.2651 5.7626 12.9804 5.64471 12.7121 5.49543C12.2237 5.22367 11.8158 4.81578 11 4L10.4497 3.44975C10.1763 3.17633 10.0396 3.03961 9.89594 2.92051C9.27652 2.40704 8.51665 2.09229 7.71557 2.01738C7.52976 2 7.33642 2 6.94975 2C6.06722 2 5.62595 2 5.25839 2.06935C3.64031 2.37464 2.37464 3.64031 2.06935 5.25839C2 5.62595 2 6.06722 2 6.94975V14C2 17.7712 2 19.6569 3.17157 20.8284C4.34315 22 6.22876 22 10 22H14C17.7712 22 19.6569 22 20.8284 20.8284C22 19.6569 22 17.7712 22 14Z" opacity=".5"/><path d="M12.25 10C12.25 9.58579 12.5858 9.25 13 9.25H18C18.4142 9.25 18.75 9.58579 18.75 10C18.75 10.4142 18.4142 10.75 18 10.75H13C12.5858 10.75 12.25 10.4142 12.25 10Z"/></g></svg>
            <span class="truncate font-medium">${escapeHtml(f.name)}</span>
            <span class="text-xs text-muted-foreground ml-auto">${f.count}</span>
          </a>`;
        })
        .join('')}</div>`
    : '';

  // Rows still on a previous storage: their links keep working, and this
  // banner offers the safe move (copy, rewrite entry URLs, never delete).
  const migrateBanner = staleCount
    ? `<div class="border border-border bg-card shadow-xs p-4 flex flex-wrap items-center gap-3">
        <p class="text-sm m-0 flex-1 min-w-64">${staleCount} file${staleCount === 1 ? ' is' : 's are'} still served from a previous storage. Links keep working. Migrating copies them to the current storage (existing objects are never overwritten), rewrites every entry to the new URLs, and leaves the old copies in place so you can delete the old bucket later.</p>
        <form method="post" action="${base}/media/migrate">${button({ label: 'Migrate media to current storage' })}</form>
      </div>`
    : '';

  // Migrated rows whose old copy is still on the previous storage: offer
  // the deliberate delete. Checks existence first, reports per file.
  const cleanupBanner = oldCopyCount
    ? `<div class="border border-border bg-card shadow-xs p-4 flex flex-wrap items-center gap-3">
        <p class="text-sm m-0 flex-1 min-w-64">${oldCopyCount} migrated file${oldCopyCount === 1 ? ' still has its' : 's still have their'} old cop${oldCopyCount === 1 ? 'y' : 'ies'} on the previous storage. Everything already serves from the current storage; the old copies are only taking up space. Deleting checks each object still exists and reports what it found.</p>
        <form method="post" action="${base}/media/cleanup" data-confirm="cleanup-media">${button({ label: 'Delete old copies now', variant: 'outline' })}</form>
      </div>`
    : '';

  return layout({
    title: `Media · ${project.name}`,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      ${pageHeader('Media', `<div class="flex items-center gap-2">
        ${popover({
          summary: 'Sync storage',
          children: `<form method="post" action="${base}/media/sync" class="flex flex-col gap-4">
            <p class="text-xs text-muted-foreground m-0">Check lists what a sync would do (files to adopt, rows whose file is gone) without changing anything. Adopt them from the report.</p>
            ${storageSelect('storage', 'Which storage to check')}
            ${button({ label: 'Check storage', variant: 'outline' })}
          </form>`,
        })}
        ${popover({
          summary: '+ Upload',
          children: `<form method="post" action="${base}/media" enctype="multipart/form-data" class="flex flex-col gap-4"${directUpload ? ` data-direct-upload="${base}/media"` : ''}>
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium text-foreground">File (50 MB max)</span>
              <input type="file" name="file" required class="${FILE_INPUT_CLASS}">
            </label>
            ${storages.length > 1 ? `<label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium text-foreground">Storage</span>
              ${storageSelect('storage', 'Where this file is stored')}
            </label>` : ''}
            ${variantCheckbox}
            ${directUpload ? '<p class="text-xs text-muted-foreground m-0">Uploads go straight from the browser to the bucket (presigned). The bucket needs a CORS rule allowing PUT from this origin.</p>' : ''}
            ${button({ label: 'Upload' })}
          </form>`,
        })}</div>`)}
      <p class="text-sm text-muted-foreground">Copy MD copies a markdown snippet to paste into any markdown field.${publicBase ? ` Links use the storage domain <code>${escapeHtml(publicBase)}</code> directly, so they never depend on this CMS or the project slug. Previews are resized on the fly by wsrv.nl.` : ` Files are served at <code>/media/${escapeHtml(project.slug)}/&lt;key&gt;</code> with immutable caching. The slug never changes (rename only changes the display name), so links stay stable.`}</p>
      ${migrateBanner}
      ${cleanupBanner}
      ${reportBlock}
      ${syncBlock}
      ${breadcrumb}
      ${folderCards}
      ${media.length
        ? `<div class="flex items-center gap-2 max-w-md">
            <input type="search" placeholder="Search by name" data-media-search class="${INPUT_CLASS}">
            ${storageLabels.length > 1 ? `<select data-media-storage-filter class="${SELECT_CLASS} w-auto" title="Filter by storage">
              <option value="">All storages</option>
              ${storageLabels.map((s: string) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}
            </select>` : ''}
          </div>
          <div class="grid gap-4 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">${cards}</div>`
        : subfolders.length
          ? ''
          : '<p class="text-sm text-muted-foreground italic">No media yet. Upload with the + button.</p>'}
    `,
  });
}

// ---- Transfer (export/import + schema-as-code) ----------------------------

export function transferPage({ user, projects, project, collections, fieldTypes, notice: pageNotice, report }: any): string {
  const base = `/admin/projects/${project.slug}`;
  const exportLinks = collections
    .map((c: any) => `<li><a class="text-link hover:underline" href="${base}/collections/${c.slug}/export.json" download>${escapeHtml(c.name)} (JSON)</a></li>`)
    .join('');
  const reportBlock = report ? preBlock(JSON.stringify(report, null, 2)) : '';
  return layout({
    title: `Transfer · ${project.name}`,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      ${pageHeader('Transfer')}
      <div class="grid gap-6 @3xl:grid-cols-2 items-start">
        <div class="${CARD_CLASS}">
          <span class="text-sm font-medium">Export</span>
          <ul class="list-none p-0 m-0 flex flex-col gap-1 text-sm">
            <li><a class="text-link hover:underline" href="${base}/export.json" download>Whole project (schema + entries)</a></li>
            <li><a class="text-link hover:underline" href="${base}/schema.json" download>Schema only (collections + fields)</a></li>
            ${exportLinks}
          </ul>
        </div>
        <div class="${CARD_CLASS}">
          <span class="text-sm font-medium">Import content</span>
          <p class="text-xs text-muted-foreground m-0">JSON (Boring CMS export or an array of flat objects) or CSV with a header row. Nothing is written until you confirm the mapping and dry-run report.</p>
          <form method="post" action="${base}/import" enctype="multipart/form-data" class="flex flex-col gap-4">
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium text-foreground">File</span>
              <input type="file" name="file" required accept=".json,.csv,application/json,text/csv" class="${FILE_INPUT_CLASS}">
            </label>
            ${selectField({
              label: 'Into collection',
              name: 'collection',
              required: true,
              options: collections.map((c: any) => ({ value: c.slug, label: c.name })),
            })}
            ${button({ label: 'Upload and map fields' })}
          </form>
        </div>
        <div class="${CARD_CLASS} @3xl:col-span-2">
          <span class="text-sm font-medium">Apply schema</span>
          <p class="text-xs text-muted-foreground m-0">Round trip: <a class="text-link hover:underline" href="${base}/schema.json" download>export this project's schema</a>, keep it in your site repo as the source of truth, paste it back here to sync. Missing collections are created, changed ones updated, nothing is deleted unless the checkbox is on. Safe to re-apply.</p>
          <form method="post" action="${base}/schema/apply" class="flex flex-col gap-4">
            <textarea name="schema" rows="10" required spellcheck="false" placeholder='{ "collections": [ { "name": "Posts", "slug": "posts", "fields": [ { "name": "title", "label": "Title", "type": "text" } ] } ] }' class="${TEXTAREA_CLASS}"></textarea>
            ${checkbox({ name: 'delete_missing', label: 'Delete collections not in the schema (destructive)' })}
            ${button({ label: 'Apply schema' })}
          </form>
          ${reportBlock}
        </div>
      </div>
    `,
  });
}

export function importMappingPage({ user, projects, project, collection, importId, sourceFields, rowCount, fieldTypes, notice: pageNotice }: any): string {
  const base = `/admin/projects/${project.slug}`;
  const targetOptions = collection.fields
    .map((f: any) => `<option value="field:${f.name}">${escapeHtml(f.label)} (${f.type})</option>`)
    .join('');
  const createOptions = fieldTypes.map((t: string) => `<option value="create:${t}">create new ${t} field</option>`).join('');
  const rows = sourceFields
    .map((s: string, i: number) => {
      // Auto-select an existing field whose name matches the source field.
      const match = collection.fields.find((f: any) => f.name === s || f.label === s);
      return `<tr class="border-b border-border">
        <td class="p-2 text-sm"><code>${escapeHtml(s)}</code><input type="hidden" name="src_${i}" value="${escapeHtml(s)}"></td>
        <td class="p-2">
          <select name="map_${i}" class="${SELECT_CLASS}">
            <option value="skip">skip</option>
            ${match ? targetOptions.replace(`value="field:${match.name}"`, `value="field:${match.name}" selected`) : targetOptions}
            ${createOptions}
          </select>
        </td>
      </tr>`;
    })
    .join('');
  const uniqueOptions = collection.fields.map((f: any) => `<option value="${f.name}">${escapeHtml(f.label)}</option>`).join('');
  return layout({
    title: `Import mapping · ${project.name}`,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      ${pageHeader('Map fields')}
      <p class="text-sm text-muted-foreground">${rowCount} rows into <strong>${escapeHtml(collection.name)}</strong>. Choose where each source field goes; nothing is written yet.</p>
      <form method="post" action="${base}/import/${importId}/check" class="flex flex-col gap-5 max-w-2xl">
        <div class="border border-border bg-card overflow-x-auto">
          <table class="w-full border-collapse">
            ${tableHead([{ label: 'Source field' }, { label: 'Maps to' }])}
            <tbody>${rows}</tbody>
          </table>
        </div>
        <label class="flex flex-col gap-1.5 text-sm max-w-xs">
          <span class="font-medium text-foreground">Unique field (optional)</span>
          <select name="unique" class="${SELECT_CLASS}">
            <option value="">none: every row becomes a new entry</option>
            ${uniqueOptions}
          </select>
          <span class="text-xs text-muted-foreground">Rows matching an existing entry on this field update it instead of duplicating. Makes re-imports safe.</span>
        </label>
        ${button({ label: 'Dry run' })}
      </form>
    `,
  });
}

export function importReportPage({ user, projects, project, collection, importId, report, form, notice: pageNotice }: any): string {
  const base = `/admin/projects/${project.slug}`;
  // Replay the confirmed mapping through hidden inputs so apply runs the
  // exact plan the user saw.
  const mappingInputs = Object.entries(form)
    .filter(([k]) => /^(src_|map_)\d+$/.test(k) || k === 'unique')
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('');
  const failures = Object.entries(report.coercionFailures)
    .map(([f, n]) => `<li>${escapeHtml(f)}: ${n} value(s) do not fit the field type (kept raw)</li>`)
    .join('');
  return layout({
    title: `Import dry run · ${project.name}`,
    user,
    projects,
    project,
    notice: pageNotice,
    body: `
      ${pageHeader('Dry run report')}
      <div class="${CARD_CLASS} max-w-2xl">
        <ul class="list-none p-0 m-0 flex flex-col gap-1 text-sm">
          <li>${report.total} rows: <strong>${report.created} new</strong>, <strong>${report.updated} updated</strong></li>
          ${report.newFields.length ? `<li>New fields: ${report.newFields.map((f: any) => `${escapeHtml(f.label)} (${f.type})`).join(', ')}</li>` : ''}
          ${failures || '<li class="text-muted-foreground">All values fit their field types.</li>'}
        </ul>
        <span class="text-sm font-medium">Sample</span>
        ${preBlock(JSON.stringify(report.sample, null, 2))}
        <form method="post" action="${base}/import/${importId}/apply" class="flex gap-2">
          ${mappingInputs}
          ${button({ label: `Import ${report.total} rows` })}
          <a class="${BUTTON_BASE} ${BUTTON_VARIANTS.outline}" href="${base}/transfer">Cancel</a>
        </form>
      </div>
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
