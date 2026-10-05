import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'mailquota.theme';
const listeners = new Set<() => void>();
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function stored(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

let choice = stored();

// 没有手动选择时不写属性，由样式里的 color-scheme 跟随系统。
function apply() {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = choice;
}

export function initTheme() {
  apply();
  darkQuery.addEventListener('change', () => listeners.forEach(listener => listener()));
}

export function setTheme(next: ThemeChoice) {
  const commit = () => {
    choice = next;
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch { /* 隐私模式下无法保存，仅本次生效 */ }
    apply();
    listeners.forEach(listener => listener());
  };
  if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(commit);
  else commit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => `${choice}:${choice === 'system' ? (darkQuery.matches ? 'dark' : 'light') : choice}`;

export function useTheme() {
  const [current, resolved] = useSyncExternalStore(subscribe, snapshot).split(':') as [ThemeChoice, 'light' | 'dark'];
  return { choice: current, resolved };
}
