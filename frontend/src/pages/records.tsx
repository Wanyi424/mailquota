import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { customerPath, useAdmin, useTitle } from '../app/admin';
import { briefReason, dateBoundary, explainRecord, formatDateTime, formatDay, formatElapsed, formatNumber, formatRelative, rangeStart, recordCaveat, STATUS, type RangePreset } from '../lib/format';
import { invalidate, setQueryData, useQuery } from '../lib/query';
import type { RequestFilters, RequestPage, RequestRow, SendStatus } from '../types';
import { Button, CopyButton, EmptyState, ErrorState, Field, FormError, Skeleton, StatusBadge, cx } from '../ui/controls';
import { Dropdown } from '../ui/dropdown';
import { Icon } from '../ui/icon';
import { Drawer, useConfirm, useToast } from '../ui/overlay';

const PAGE_SIZE = 20;
const PRESETS: Array<[RangePreset | '', string]> = [['', '全部时间'], ['today', '今天'], ['7d', '近 7 天'], ['30d', '近 30 天']];
const isPreset = (value: string): value is RangePreset => PRESETS.some(([preset]) => preset !== '' && preset === value);
const isStatus = (value: string): value is SendStatus => value in STATUS;
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function RecordsPage() {
  useTitle('发送记录');
  return (
    <>
      <header className="page-head reveal"><h1>发送记录</h1></header>
      <Records />
    </>
  );
}

type Changes = Record<string, string | null>;

/** 发送流水：筛选条件全部写在地址里，刷新、后退都能回到同一个视图。传 customerId 时只看这一位客户。 */
export function Records({ customerId }: { customerId?: string }) {
  const { api } = useAdmin();
  const [params, setParams] = useSearchParams();
  const customers = useQuery('customers', api.customers).data ?? [];
  const unresolved = useQuery('stats:7', () => api.stats(7)).data?.unresolved ?? 0;
  const { recordId, drawer } = useRecordDrawer(Boolean(customerId));

  const rawStatus = params.get('status') ?? '';
  const status = isStatus(rawStatus) ? rawStatus : '';
  const q = params.get('q') ?? '';
  const range = params.get('range') ?? '';
  const customer = customerId ?? params.get('customer') ?? '';
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

  const filters: RequestFilters = { page, page_size: PAGE_SIZE, customer_id: customer || undefined, status: status || undefined, q: q || undefined, from, to };
  const list = useQuery(rangeError ? null : `requests:${JSON.stringify(filters)}`, () => api.requests(filters));
  // 换筛选条件时先留着上一批结果（变淡），新结果到了再替换，列表不会闪成空白。
  const previous = useRef<RequestPage | undefined>(undefined);
  if (list.data) previous.current = list.data;
  const data = list.data ?? (list.error ? undefined : previous.current);
  const filtered = Boolean(status || q || range || (!customerId && customer));
  // 只有一位客户，或者本来就在某位客户的页面里时，客户这一列和这个筛选都没有信息量。
  const showCustomer = !customerId && customers.length > 1;

  // 以地址栏此刻的参数为准来改，连续操作（边输入边点筛选）不会互相覆盖。
  const update = (changes: Changes, { keepPage = false, replace = true, keepScroll = true } = {}) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!keepPage) next.delete('page');
    setParams(next, { replace, preventScrollReset: keepScroll });
  };

  const [text, setText] = useState(q);
  useEffect(() => { setText(current => (current.trim() === q ? current : q)); }, [q]);
  useEffect(() => {
    const value = text.trim();
    if (value === q) return;
    const timer = window.setTimeout(() => update({ q: value || null }), 350);
    return () => window.clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // 筛选变窄后当前页码可能已经不存在，退回到最后一页。
  const total = data?.total ?? 0;
  const overflow = list.data && list.data.items.length === 0 && total > 0 && page > 1;
  useEffect(() => {
    if (overflow) update({ page: String(Math.ceil(total / PAGE_SIZE)) }, { keepPage: true });
  }, [overflow]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = (id: string) => customers.find(item => item.customer_id === id)?.name ?? id;
  const rowClass = cx('trow record-row', !showCustomer && 'record-row--scoped');

  return (
    <div className="records reveal">
      {/* 工具栏里每个控件的位置和宽度都是固定的：选什么、清什么，这一行都不会动。 */}
      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input type="search" value={text} onChange={event => setText(event.target.value)} placeholder="搜索邮箱或请求编号" title="邮箱按包含匹配，请求编号需要完整粘贴" aria-label="搜索邮箱或请求编号" autoComplete="off" spellCheck={false} />
        </label>
        <select className="select toolbar__select" value={status} onChange={event => update({ status: event.target.value || null })} aria-label="按状态筛选">
          <option value="">全部状态</option>
          <option value="accepted">{STATUS.accepted.label}</option>
          <option value="failed">{STATUS.failed.label}</option>
          <option value="pending">{STATUS.pending.label}</option>
          {/* 结果不明极少出现：只有真的存在，或者正在看它时，才把这一项摆出来。 */}
          {unresolved > 0 || status === 'unknown' ? <option value="unknown">{`${STATUS.unknown.label}${unresolved ? `（${formatNumber(unresolved)}）` : ''}`}</option> : null}
        </select>
        {showCustomer ? (
          <select className="select toolbar__select toolbar__select--wide" value={customer} onChange={event => update({ customer: event.target.value || null })} aria-label="按客户筛选">
            <option value="">全部客户</option>
            {customers.map(item => <option key={item.customer_id} value={item.customer_id}>{item.name}</option>)}
            {customer && !customers.some(item => item.customer_id === customer) ? <option value={customer}>{customer}</option> : null}
          </select>
        ) : null}
        <DateRange range={range} from={params.get('from') ?? ''} to={params.get('to') ?? ''} onPick={update} />
        <Button variant="ghost" icon="undo-2" disabled={!filtered} onClick={() => { setText(''); update({ status: null, q: null, range: null, from: null, to: null, customer: null }); }}>重置</Button>
      </div>

      <div className={cx('panel table', list.fetching && data && 'is-refreshing')}>
        <div className={cx(rowClass, 'trow--head')}>
          <span>状态</span>
          <span>收件邮箱</span>
          {showCustomer ? <span>客户</span> : null}
          <span>说明</span>
          <span className="record__time">时间</span>
          <span />
        </div>
        {rangeError ? (
          <EmptyState icon="calendar-days" title="日期范围不对">{rangeError}</EmptyState>
        ) : !data && !list.error || overflow ? (
          <div className="records__skeleton" aria-busy="true" aria-label="正在读取">
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} width="100%" height={22} />)}
          </div>
        ) : !data ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : data.items.length === 0 ? (
          status === 'unknown' && !q && !range
            ? <EmptyState icon="circle-check" title="没有结果不明的记录">所有发送都已经有明确的结果。</EmptyState>
            : filtered
              ? <EmptyState icon="search" title="没有符合条件的记录">{q ? '邮箱按包含匹配，请求编号需要完整粘贴。换个关键词，或放宽其它筛选条件。' : '放宽筛选条件再看看。'}</EmptyState>
              : <EmptyState icon="send" title="还没有发送记录">客户后端调用发送接口之后，每一封都会出现在这里。</EmptyState>
        ) : (
          <ul className="table__body">
            {data.items.map(row => (
              <li key={row.id}>
                <RecordLink row={row} className={cx(rowClass, row.id === recordId && 'is-open')}>
                  <StatusBadge status={row.status} />
                  <span className="record__email mono">{row.email}</span>
                  {showCustomer ? <span className="record__customer">{name(row.customer_id)}</span> : null}
                  <span className="record__note">{row.resolved_by ? '人工结算' : briefReason(row.error_code)}</span>
                  <time className="record__time" dateTime={new Date(row.created_at).toISOString()} title={formatDateTime(row.created_at)}>{formatRelative(row.created_at)}</time>
                  <Icon name="chevron-right" size={16} />
                </RecordLink>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && total > 0 ? (
        <Pager page={page} total={total} onChange={next => update({ page: next > 1 ? String(next) : null }, { keepPage: true, replace: false, keepScroll: false })} />
      ) : null}

      {drawer}
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

function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <div className="pager">
      <span>共 {formatNumber(total)} 条{pages > 1 ? ` · 第 ${page} / ${formatNumber(pages)} 页` : ''} · 北京时间</span>
      {pages > 1 ? (
        <div className="pager__buttons">
          <Button size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</Button>
          <Button size="sm" trailingIcon="chevron-right" disabled={page >= pages} onClick={() => onChange(page + 1)}>下一页</Button>
        </div>
      ) : null}
    </div>
  );
}

/** 指向某条记录详情的链接：在当前地址上加一个 record 参数，其它筛选条件原样保留。 */
export function RecordLink({ row, className, children }: { row: RequestRow; className?: string; children: ReactNode }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('record', String(row.id));
  return (
    <Link className={className} to={{ search: next.toString() }} state={{ fromList: true }} preventScrollReset onClick={() => setQueryData(`request:${row.id}`, row)}>
      {children}
    </Link>
  );
}

/**
 * 记录详情抽屉由地址里的 record 参数驱动，任何列出记录的页面都可以就地打开它。
 * scoped 表示已经在某位客户的页面里，详情里不必再写是哪位客户。
 */
export function useRecordDrawer(scoped: boolean) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const recordId = Number(params.get('record')) || null;

  const close = () => {
    // 从列表点开的抽屉，关闭就是后退一步；直接打开带 record 参数的地址时没有可退的一步。
    if ((location.state as { fromList?: boolean } | null)?.fromList) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(window.location.search);
    next.delete('record');
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return { recordId, drawer: recordId ? <RecordDrawer key={recordId} id={recordId} scoped={scoped} onClose={close} /> : null };
}

function RecordDrawer({ id, scoped, onClose }: { id: number; scoped: boolean; onClose: () => void }) {
  const { api } = useAdmin();
  const record = useQuery(`request:${id}`, () => api.request(id));
  const customers = useQuery('customers', api.customers).data ?? [];
  const row = record.data;
  return (
    <Drawer label="发送记录详情" onClose={onClose} header={<>发送记录<span className="muted mono">#{id}</span></>}>
      {record.loading ? (
        <div className="records__skeleton" aria-busy="true"><Skeleton width="40%" height={24} /><Skeleton width="80%" height={28} /><Skeleton width="100%" height={220} /></div>
      ) : !row ? (
        (record.error as { code?: string })?.code === 'REQUEST_NOT_FOUND'
          ? <EmptyState icon="circle-help" title="没有这条记录">地址里的记录编号不存在。</EmptyState>
          : <ErrorState error={record.error} onRetry={record.reload} />
      ) : (
        <RecordDetail row={row} customerName={scoped ? null : customers.find(item => item.customer_id === row.customer_id)?.name ?? row.customer_id} />
      )}
    </Drawer>
  );
}

const SETTLED_AT: Record<SendStatus, string> = { accepted: '受理时间', failed: '失败时间', unknown: '更新时间', pending: '' };

/** 抽屉先给结论（什么状态、哪个邮箱、一句话解释），再给一张明细表；需要人处理的结算放在两者之间。 */
function RecordDetail({ row, customerName }: { row: RequestRow; customerName: string | null }) {
  const caveat = recordCaveat(row);
  return (
    <>
      <div className="record-hero">
        <StatusBadge status={row.status} size="lg" />
        <div className="record-hero__email">
          <span className="mono">{row.email}</span>
          <CopyButton value={row.email} label="复制邮箱" />
        </div>
        <p className="record-hero__story">{explainRecord(row)}</p>
        {caveat ? <p className="record-hero__caveat">{caveat}</p> : null}
      </div>

      {row.status === 'unknown' ? <ResolvePanel row={row} /> : null}

      <dl className="kv kv--detail">
        <div><dt>提交时间</dt><dd>{formatDateTime(row.created_at)}</dd></div>
        {row.resolved_at ? (
          <>
            <div><dt>人工结算</dt><dd>{formatDateTime(row.resolved_at)}<span className="muted">由 {row.resolved_by} 操作</span></dd></div>
            {row.resolution_note ? <div><dt>结算备注</dt><dd>{row.resolution_note}</dd></div> : null}
          </>
        ) : row.status !== 'pending' ? (
          <div><dt>{SETTLED_AT[row.status]}</dt><dd>{formatDateTime(row.updated_at)}<span className="muted">用时 {formatElapsed(row.updated_at - row.created_at)}</span></dd></div>
        ) : null}
        {customerName === null ? null : (
          <div><dt>客户</dt><dd><Link className="link" to={customerPath(row.customer_id)} viewTransition>{customerName}</Link></dd></div>
        )}
        <div><dt>请求编号</dt><dd><span className="mono">{row.request_id}</span><CopyButton value={row.request_id} label="复制请求编号" /></dd></div>
        <div><dt>用户 IP</dt><dd><span className="mono">{row.client_ip}</span></dd></div>
        {row.provider_message_id ? <div><dt>服务商回执</dt><dd><span className="mono">{row.provider_message_id}</span></dd></div> : null}
        {row.error_code ? <div><dt>错误代码</dt><dd><span className="mono">{row.error_code}</span></dd></div> : null}
      </dl>
      <p className="drawer__foot">时间均为北京时间。这里不保存验证码和邮件正文。</p>
    </>
  );
}

const CHOICES = [
  { value: 'accepted', title: '确实发出了', detail: '服务商后台能查到这封邮件已被受理。计入已用 1 封。', done: '已按「确实发出了」结算，计入已用 1 封。' },
  { value: 'failed', title: '没有发出', detail: '服务商后台查不到，或显示被拒收。退回这 1 封额度，这封邮件里的验证码同时作废。', done: '已按「没有发出」结算，退回 1 封额度。' },
] as const;

/** 结果不明的记录在抽屉里就地结算：选结论、可选备注，提交前再确认一次。 */
function ResolvePanel({ row }: { row: RequestRow }) {
  const { api } = useAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const [choice, setChoice] = useState<'accepted' | 'failed' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const picked = CHOICES.find(item => item.value === choice);

  const settle = async () => {
    if (!picked || busy) return;
    if (!await confirm({ title: `按「${picked.title}」结算？`, body: '结算后不能撤销，也不会重新发送邮件。', confirmLabel: '确认结算' })) return;
    setBusy(true);
    setError(undefined);
    try {
      setQueryData(`request:${row.id}`, await api.resolve(row.id, picked.value, note.trim()));
      toast(picked.done);
    } catch (failure) {
      setError(failure);
      // 已被别处处理时，下面的刷新会把这条记录换成最新状态。
      if ((failure as { code?: string }).code === 'STATE_CONFLICT') invalidate(`request:${row.id}`);
    } finally {
      invalidate('requests', 'stats', 'customers', 'customer:');
      setBusy(false);
    }
  };

  return (
    <section className="resolve">
      <header>
        <h3>需要你核查后结算</h3>
        <p>到邮件服务商后台，按发送时间和收件邮箱查一下这封邮件，再选择结论。进了垃圾箱也算发出。</p>
      </header>
      <FormError error={error} />
      <div className="resolve__choices" role="radiogroup" aria-label="核查结论">
        {CHOICES.map(item => (
          <button type="button" key={item.value} role="radio" aria-checked={choice === item.value} className={cx('resolve__choice', choice === item.value && 'is-picked')} onClick={() => setChoice(item.value)}>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </button>
        ))}
      </div>
      <Field label="备注" tip="比如在服务商后台看到了什么。会和你的账号一起记在这条记录上。">
        <textarea className="input" rows={2} maxLength={2000} placeholder="选填" value={note} onChange={event => setNote(event.target.value)} />
      </Field>
      <Button variant="primary" busy={busy} disabled={!picked} onClick={() => void settle()}>{picked ? `按「${picked.title}」结算` : '先选择一个结论'}</Button>
    </section>
  );
}
