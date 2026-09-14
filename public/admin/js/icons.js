// Lucide 0.468.0; original paths vendored in icons/lucide.svg, license alongside.
const names = new Set(['users', 'mail', 'send', 'circle-help', 'eye', 'eye-off', 'refresh-cw', 'plus', 'search', 'menu', 'log-out', 'x', 'chevron-left', 'chevron-right', 'copy', 'pencil', 'key-round', 'power', 'sliders-horizontal', 'save', 'smartphone', 'monitor', 'check', 'arrow-left', 'external-link']);
export function icon(name) {
  if (!names.has(name)) throw new Error(`Unknown icon: ${name}`);
  return `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="/admin/assets/icons/lucide.svg#${name}"></use></svg>`;
}
