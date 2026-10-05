import { ICONS, type IconName } from './icons';

export type { IconName };

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/** 品牌标记：一只读数走到一半多的计量表。颜色在样式表里跟随主题。 */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect className="brand-mark__bg" width="24" height="24" rx="7" />
      <path className="brand-mark__track" d="M6 15.5a6 6 0 0 1 12 0" />
      <path className="brand-mark__reading" d="M6 15.5a6 6 0 0 1 7.85-5.71" />
      <circle className="brand-mark__pivot" cx="12" cy="15.5" r="1.4" />
    </svg>
  );
}
