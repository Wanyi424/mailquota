import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dateBoundary, formatDay, formatNumber, rangeStart, STATUS, type RangePreset } from '../lib/format';
import type { Page, RecordFilters, SendStatus } from '../types';
import { Button, cx } from '../ui/controls';
import { Dropdown } from '../ui/dropdown';
import { Icon } from '../ui/icon';

// 发送记录页在两个门户里是同一套交互：筛选条件写在地址里，表格上方一条固定的工具栏，下方翻页。
// 这里是共用的部分；表格有哪些列、点开一条看到什么，由各自的页面决定。

export const PAGE_SIZE = 20;
const PRESETS: Array<[RangePreset | '', string]> = [['', '全部时间'], ['today', '今天'], ['7d', '近 7 天'], ['30d', '近 30 天']];
const isPreset = (value: string): value is RangePreset => PRESETS.some(([preset]) => preset !== '' && preset === value);
const isStatus = (value: string): value is SendStatus => value in STATUS;
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

type Changes = Record<string, string | null>;
type UpdateOptions = { keepPage?: boolean; replace?: boolean; keepScroll?: boolean };

/** 把地址里的参数解析成接口要的筛选条件，并提供修改它们的方法。刷新、后退都能回到同一个视图。 */
export function useRecordFilters() {
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get('status') ?? '';
  const status: SendStatus | '' = isStatus(rawStatus) ? rawStatus : '';
  const q = params.get('q') ?? '';
  const range = params.get('range') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  let from: number | undefined;
  let to: number | undefined;
  let rangeError = '';
  if (isPreset(range)) {
    from = rangeStart(range);
  } else if (range === 'custom') {
    try {
      from = dateBoundary(params.get('from') ?? undefined);
      to = dateBoundary(params.get('to') ?? undefined, true);
      if (from !== undefined && to !== undefined && from > to) throw new Error('开始日期不能晚于结束日期。');
    } catch (error) {
      rangeError = (error as Error).message;
    }
  }

  // 以地址栏此刻的参数为准来改，连续操作（边输入边点筛选）不会互相覆盖。
  const update = (changes: Changes, { keepPage = false, replace = true, keepScroll = true }: UpdateOptions = {}) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!keepPage) next.delete('page');
    setParams(next, { replace, preventScrollReset: keepScroll });
  };

  // 搜索框里的字先留在本地，停顿一下再写进地址。
  const [text, setText] = useState(q);
  useEffect(() => { setText(current => (current.trim() === q ? current : q)); }, [q]);
  useEffect(() => {
    const value = text.trim();
    if (value === q) return;
    const timer = window.setTimeout(() => update({ q: value || null }), 350);
    return () => window.clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const query: RecordFilters = {
    page,
    page_size: PAGE_SIZE,
    status: status || undefined,
    q: q || undefined,
    from: from === undefined ? undefined : new Date(from).toISOString(),
    to: to === undefined ? undefined : new Date(to).toISOString(),
  };

  return {
    params,
    status,
    q,
    range,
    page,
    /** 自定义日期填得不对时的说明；有值时不要发请求。 */
    rangeError,
    /** 可以直接交给接口的筛选条件。 */
    query,
    /** 状态、关键词、时间三项里是否有任何一项在生效。 */
    active: Boolean(status || q || range),
    update,
    text,
    setText,
  };
}

export type RecordFilterState = ReturnType<typeof useRecordFilters>;

/** 筛选变窄后当前页码可能已经不存在，这时退回到最后一页。返回 true 表示正在退回，先别显示「没有数据」。 */
export function usePageOverflow(filters: RecordFilterState, loaded: Page<unknown> | undefined) {
  const total = loaded?.total ?? 0;
  const overflow = Boolean(loaded && loaded.items.length === 0 && total > 0 && filters.page > 1);
  useEffect(() => {
    if (overflow) filters.update({ page: String(Math.ceil(total / PAGE_SIZE)) }, { keepPage: true });
  }, [overflow]); // eslint-disable-line react-hooks/exhaustive-deps
  return overflow;
}

/**
 * 表格上方的工具栏。每个控件的位置和宽度都是固定的：选什么、清什么，这一行都不会动。
 * children 是插在状态和时间之间的额外筛选，比如管理端的「按租户」。
 */
export function RecordsToolbar({ filters, unknown = false, unknownCount = 0, extra = [], extraActive = false, children }: {
  filters: RecordFilterState;
  /** 结果不明极少出现：只有真的存在，或者正在看它时，才把这一项摆出来。 */
  unknown?: boolean;
  unknownCount?: number;
  /** children 里的额外筛选用到的地址参数名，「重置」时一并清掉。 */
  extra?: string[];
  /** 额外筛选是否正在生效。 */
  extraActive?: boolean;
  children?: ReactNode;
}) {
  const reset = () => {
    filters.setText('');
    filters.update({ status: null, q: null, range: null, from: null, to: null, ...Object.fromEntries(extra.map(key => [key, null])) });
  };
  return (
    <div className="toolbar">
      <label className="search">
        <Icon name="search" size={16} />
        <input type="search" value={filters.text} onChange={event => filters.setText(event.target.value)} placeholder="搜索邮箱或请求编号" title="邮箱按包含匹配，请求编号需要完整粘贴" aria-label="搜索邮箱或请求编号" autoComplete="off" spellCheck={false} />
      </label>
      <select className="select toolbar__select" value={filters.status} onChange={event => filters.update({ status: event.target.value || null })} aria-label="按状态筛选">
        <option value="">全部状态</option>
        <option value="accepted">{STATUS.accepted.label}</option>
        <option value="failed">{STATUS.failed.label}</option>
        <option value="pending">{STATUS.pending.label}</option>
        {unknown || filters.status === 'unknown' ? <option value="unknown">{`${STATUS.unknown.label}${unknownCount ? `（${formatNumber(unknownCount)}）` : ''}`}</option> : null}
      </select>
      {children}
      <DateRange range={filters.range} from={filters.params.get('from') ?? ''} to={filters.params.get('to') ?? ''} onPick={filters.update} />
      <Button variant="ghost" icon="undo-2" disabled={!filters.active && !extraActive} onClick={reset}>重置</Button>
    </div>
  );
}

function rangeLabel(range: string, from: string, to: string) {
  if (range !== 'custom') return PRESETS.find(([preset]) => preset === range)?.[1] ?? PRESETS[0][1];
  const start = isDate(from) ? formatDay(from) : '';
  const end = isDate(to) ? formatDay(to) : '';
  return start && end ? `${start} – ${end}` : start ? `${start} 起` : end ? `截至 ${end}` : '自定义日期';
}

/** 时间筛选：一个固定宽度的下拉按钮，快捷范围和自定义日期都在点开的浮层里选。 */
function DateRange({ range, from, to, onPick }: { range: string; from: string; to: string; onPick: (changes: Changes) => void }) {
  return (
    <Dropdown label={rangeLabel(range, from, to)} title="按时间筛选" className="toolbar__range">
      {close => <RangePanel range={range} from={from} to={to} onPick={changes => { onPick(changes); close(); }} />}
    </Dropdown>
  );
}

function RangePanel({ range, from, to, onPick }: { range: string; from: string; to: string; onPick: (changes: Changes) => void }) {
  const [start, setStart] = useState(range === 'custom' ? from : '');
  const [end, setEnd] = useState(range === 'custom' ? to : '');
  const backwards = Boolean(start && end && start > end);
  const current = range === 'custom' ? null : isPreset(range) ? range : '';

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!backwards && (start || end)) onPick({ range: 'custom', from: start || null, to: end || null });
  };

  return (
    <div className="range">
      <ul className="menu">
        {PRESETS.map(([preset, text]) => (
          <li key={preset}>
            <button type="button" className={cx('menu__item', preset === current && 'is-picked')} onClick={() => onPick({ range: preset || null, from: null, to: null })}>
              {text}
              {preset === current ? <Icon name="check" size={15} /> : null}
            </button>
          </li>
        ))}
      </ul>
      <form className={cx('range__custom', range === 'custom' && 'is-picked')} onSubmit={apply}>
        <span className="range__label">自定义日期{range === 'custom' ? <Icon name="check" size={15} /> : null}</span>
        <div className="range__inputs">
          <input className="input input--sm" type="date" min="2020-01-01" max={end || undefined} value={start} onChange={event => setStart(event.target.value)} aria-label="开始日期" />
          <span>至</span>
          <input className="input input--sm" type="date" min={start || '2020-01-01'} value={end} onChange={event => setEnd(event.target.value)} aria-label="结束日期" />
        </div>
        <div className="range__foot">
          <span role="alert">{backwards ? '开始日期不能晚于结束日期' : ''}</span>
          <Button type="submit" size="sm" variant="primary" disabled={backwards || (!start && !end)}>应用</Button>
        </div>
      </form>
    </div>
  );
}

/** 翻页条。unit 是「共 N」后面的量词，note 是末尾的补充说明。 */
export function Pager({ page, total, pageSize = PAGE_SIZE, unit = '条', note, onChange }: { page: number; total: number; pageSize?: number; unit?: string; note?: string; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span>共 {formatNumber(total)} {unit}{pages > 1 ? ` · 第 ${page} / ${formatNumber(pages)} 页` : ''}{note ? ` · ${note}` : ''}</span>
      {pages > 1 ? (
        <div className="pager__buttons">
          <Button size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</Button>
          <Button size="sm" trailingIcon="chevron-right" disabled={page >= pages} onClick={() => onChange(page + 1)}>下一页</Button>
        </div>
      ) : null}
    </div>
  );
}
