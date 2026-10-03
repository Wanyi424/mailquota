const names = new Set(['users', 'mail', 'send', 'circle-help', 'eye', 'eye-off', 'refresh-cw', 'plus', 'search', 'menu', 'log-out', 'x', 'chevron-left', 'chevron-right', 'copy', 'pencil', 'key-round', 'power', 'sliders-horizontal', 'save', 'smartphone', 'monitor', 'check', 'arrow-left', 'external-link', 'triangle-alert']);

export type IconName =
  | 'users' | 'mail' | 'send' | 'circle-help' | 'eye' | 'eye-off' | 'refresh-cw' | 'plus' | 'search'
  | 'menu' | 'log-out' | 'x' | 'chevron-left' | 'chevron-right' | 'copy' | 'pencil' | 'key-round'
  | 'power' | 'sliders-horizontal' | 'save' | 'smartphone' | 'monitor' | 'check' | 'arrow-left'
  | 'external-link' | 'triangle-alert';

export function Icon({ name }: { name: IconName }) {
  if (!names.has(name)) throw new Error(`Unknown icon: ${name}`);
  return <svg className="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><use href={`/admin/assets/icons/lucide.svg#${name}`} /></svg>;
}
