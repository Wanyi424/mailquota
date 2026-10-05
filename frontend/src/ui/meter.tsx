import type { CSSProperties } from 'react';
import { formatNumber, type QuotaHealth } from '../lib/format';
import type { Customer } from '../types';
import { cx } from './controls';

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** 像电表读数一样滚动的数字：每一位是一条 0–9 的滚轮，数值变化时滚到新的位置。 */
export function Odometer({ value }: { value: number }) {
  const text = formatNumber(value);
  const chars = [...text];
  return (
    <span className="odometer">
      <span className="sr-only">{text}</span>
      <span className="odometer__row" aria-hidden="true">
        {/* 不可见的支撑字符：让整排滚轮有一条真实的文字基线，旁边的单位才能对齐。 */}
        <span className="odometer__strut">0</span>
        {chars.map((char, index) => {
          // 从个位起编号：位数增减时，每一位仍然对应自己的那条滚轮。
          const place = chars.length - index;
          return /\d/.test(char) ? (
            <span className="odometer__digit" key={place} style={{ '--place': place } as CSSProperties}>
              <span className="odometer__reel" style={{ '--digit': Number(char) } as CSSProperties}>
                {DIGITS.map(digit => <span key={digit}>{digit}</span>)}
              </span>
            </span>
          ) : (
            <span className="odometer__sep" key={`sep-${place}`}>{char}</span>
          );
        })}
      </span>
    </span>
  );
}

type Quota = Pick<Customer, 'quota_total' | 'available_count'>;

// 亮起的部分不到整条的这个比例时，条里放不下字，改写在它右边。
const LABEL_FITS_FROM = 0.25;

/**
 * 额度条只有两部分：亮起的一段是还能用的，其余是已经用掉的。
 * large 用在客户概览，条更高，并把剩余比例直接写在条里；列表里的细条不写字，数字就在它上方。
 */
export function QuotaMeter({ quota, health, large = false }: { quota: Quota; health: QuotaHealth; large?: boolean }) {
  const total = quota.quota_total;
  const ratio = total > 0 ? Math.max(0, Math.min(1, quota.available_count / total)) : 0;
  // 向下取整：还差一点才满时不写成 100%，快用完时也不会提前写成 0%。
  const percent = ratio === 0 ? '0%' : ratio < 0.01 ? '不到 1%' : `${Math.floor(ratio * 100)}%`;
  return (
    <div
      className={cx('meter', `meter--${health}`, large && 'meter--large')}
      role="img"
      aria-label={total > 0 ? `可用 ${formatNumber(quota.available_count)} 封，总额度 ${formatNumber(total)} 封` : '尚未设置额度'}
    >
      <div className="meter__track">
        {/* 还有额度就至少亮起一小段，免得看起来像已经用完。 */}
        <span className="meter__fill" style={{ width: `${ratio > 0 ? Math.max(0.8, ratio * 100) : 0}%` }}>
          {large && total > 0 ? <span className={cx('meter__label', ratio < LABEL_FITS_FROM && 'meter__label--outside')}>剩余 {percent}</span> : null}
        </span>
      </div>
    </div>
  );
}
