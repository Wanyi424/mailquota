import { useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { briefReason, explainRecord, formatDateTime, formatElapsed, formatRelative, recordCaveat } from '../../lib/format';
import { invalidate, seedQueryData, setQueryData, useQuery } from '../../lib/query';
import { HtmlBody, MailFrame, TextBody } from '../../shared/mail-preview';
import { Pager, RecordsToolbar, usePageOverflow, useRecordFilters } from '../../shared/records';
import { useTitle } from '../../shared/title';
import type { Page, SendStatus } from '../../types';
import { Button, CopyButton, EmptyState, ErrorState, Field, FormError, Segmented, Skeleton, StatusBadge, Tip, cx } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import { Drawer, useConfirm, useToast } from '../../ui/overlay';
import { tenantPath, useAdmin } from '../context';
import type { RequestDetail, RequestFilters, RequestRow } from '../types';

export function RecordsPage() {
  useTitle('发送记录');
  return (
    <>
      <header className="page-head reveal"><h1>发送记录</h1></header>
      <Records />
    </>
  );
}

/** 发送流水。传 customerId 时只看这一个租户，否则可以跨租户查找。 */
export function Records({ customerId }: { customerId?: string }) {
  const { api } = useAdmin();
  const filters = useRecordFilters();
  const tenants = useQuery('tenants', api.tenants).data ?? [];
  const unresolved = useQuery('stats/all:7', () => api.stats(7)).data?.unresolved ?? 0;
  const { recordId, drawer } = useRecordDrawer(Boolean(customerId));

  const tenant = customerId ?? filters.params.get('tenant') ?? '';
  const query: RequestFilters = { ...filters.query, customer_id: tenant || undefined };
  const list = useQuery(filters.rangeError ? null : `requests:${JSON.stringify(query)}`, () => api.requests(query));
  // 换筛选条件时先留着上一批结果（变淡），新结果到了再替换，列表不会闪成空白。
  const previous = useRef<Page<RequestRow> | undefined>(undefined);
  if (list.data) previous.current = list.data;
  const data = list.data ?? (list.error ? undefined : previous.current);
  const overflow = usePageOverflow(filters, list.data);
  const byTenant = !customerId && Boolean(tenant);
  // 只有一个租户，或者本来就在某个租户的页面里时，租户这一列和这个筛选都没有信息量。
  const showTenant = !customerId && tenants.length > 1;
  const rowClass = cx('trow record-row', !showTenant && 'record-row--scoped');

  return (
    <div className="records reveal">
      <RecordsToolbar filters={filters} unknown={unresolved > 0} unknownCount={unresolved} extra={['tenant']} extraActive={byTenant}>
        {showTenant ? (
          <select className="select toolbar__select toolbar__select--wide" value={tenant} onChange={event => filters.update({ tenant: event.target.value || null })} aria-label="按租户筛选">
            <option value="">全部租户</option>
            {tenants.map(item => <option key={item.customer_id} value={item.customer_id}>{item.name}</option>)}
            {tenant && !tenants.some(item => item.customer_id === tenant) ? <option value={tenant}>{tenant}</option> : null}
          </select>
        ) : null}
      </RecordsToolbar>

      <div className={cx('panel table', list.fetching && data && 'is-refreshing')}>
        <div className={cx(rowClass, 'trow--head')}>
          <span>状态</span>
          <span>收件邮箱</span>
          {showTenant ? <span>租户</span> : null}
          <span>说明</span>
          <span className="record__time">时间</span>
          <span />
        </div>
        {filters.rangeError ? (
          <EmptyState icon="calendar-days" title="日期范围不对">{filters.rangeError}</EmptyState>
        ) : !data && !list.error || overflow ? (
          <div className="records__skeleton" aria-busy="true" aria-label="正在读取">
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} width="100%" height={22} />)}
          </div>
        ) : !data ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : data.items.length === 0 ? (
          filters.status === 'unknown' && !filters.q && !filters.range
            ? <EmptyState icon="circle-check" title="没有结果不明的记录">所有发送都已经有明确的结果。</EmptyState>
            : filters.active || byTenant
              ? <EmptyState icon="search" title="没有符合条件的记录">{filters.q ? '邮箱按包含匹配，请求编号需要完整粘贴。换个关键词，或放宽其它筛选条件。' : '放宽筛选条件再看看。'}</EmptyState>
              : <EmptyState icon="send" title="还没有发送记录">租户的业务后端调用发送接口之后，每一封都会出现在这里。</EmptyState>
        ) : (
          <ul className="table__body">
            {data.items.map(row => (
              <li key={row.id}>
                <RecordLink row={row} className={cx(rowClass, row.id === recordId && 'is-open')}>
                  <StatusBadge status={row.status} />
                  <span className="record__email mono">{row.email}</span>
                  {showTenant ? <span className="record__tenant">{row.tenant_name}</span> : null}
                  <span className="record__note">{row.resolved_by_id ? '人工结算' : briefReason(row.smtp_error_code)}</span>
                  <time className="record__time" dateTime={row.created_at} title={formatDateTime(row.created_at)}>{formatRelative(row.created_at)}</time>
                  <Icon name="chevron-right" size={16} />
                </RecordLink>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && data.total > 0 ? (
        <Pager page={filters.page} total={data.total} note="北京时间" onChange={next => filters.update({ page: next > 1 ? String(next) : null }, { keepPage: true, replace: false, keepScroll: false })} />
      ) : null}

      {drawer}
    </div>
  );
}

/** 指向某条记录详情的链接：在当前地址上加一个 record 参数，其它筛选条件原样保留。 */
export function RecordLink({ row, className, children }: { row: RequestRow; className?: string; children: ReactNode }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('record', row.id);
  return (
    <Link className={className} to={{ search: next.toString() }} state={{ fromList: true }} preventScrollReset onClick={() => seedQueryData<RequestDetail>(`request:${row.id}`, row)}>
      {children}
    </Link>
  );
}

/**
 * 记录详情抽屉由地址里的 record 参数驱动，任何列出记录的页面都可以就地打开它。
 * scoped 表示已经在某个租户的页面里，详情里不必再写是哪个租户。
 */
export function useRecordDrawer(scoped: boolean) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  // 记录编号是正整数；别的值（比如手改过的地址）当作没有打开。
  const raw = params.get('record') ?? '';
  const recordId = /^[1-9]\d{0,18}$/.test(raw) ? raw : null;

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

function RecordDrawer({ id, scoped, onClose }: { id: string; scoped: boolean; onClose: () => void }) {
  const { api } = useAdmin();
  const record = useQuery(`request:${id}`, () => api.request(id));
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
        <RecordDetail row={row} scoped={scoped} />
      )}
    </Drawer>
  );
}

const SETTLED_AT: Record<SendStatus, string> = { accepted: '受理时间', failed: '失败时间', unknown: '更新时间', pending: '' };

/** 抽屉先给结论（什么状态、哪个邮箱、一句话解释），需要人处理的结算紧跟其后，然后是明细和当时发出的邮件。 */
function RecordDetail({ row, scoped }: { row: RequestDetail; scoped: boolean }) {
  const caveat = recordCaveat(row);
  const settled = row.completed_at ?? row.updated_at;
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
            <div><dt>人工结算</dt><dd>{formatDateTime(row.resolved_at)}<span className="muted">由 {row.resolved_by_id} 操作</span></dd></div>
            {row.resolution_note ? <div><dt>结算备注</dt><dd>{row.resolution_note}</dd></div> : null}
          </>
        ) : row.status !== 'pending' ? (
          <div><dt>{SETTLED_AT[row.status]}</dt><dd>{formatDateTime(settled)}<span className="muted">用时 {formatElapsed(row.created_at, settled)}</span></dd></div>
        ) : null}
        {scoped ? null : (
          <div><dt>租户</dt><dd><Link className="link" to={tenantPath(row.customer_id)} viewTransition>{row.tenant_name}</Link></dd></div>
        )}
        <div><dt>请求编号</dt><dd><span className="mono">{row.request_id}</span><CopyButton value={row.request_id} label="复制请求编号" /></dd></div>
        {row.reported_client_ip ? <div><dt>用户 IP</dt><dd><span className="mono">{row.reported_client_ip}</span><span className="muted">由租户上报</span></dd></div> : null}
        {row.smtp_message_id ? <div><dt>Message-ID</dt><dd><span className="mono">{row.smtp_message_id}</span></dd></div> : null}
        {row.smtp_response ? <div><dt>服务商答复</dt><dd><span className="mono">{row.smtp_response}</span></dd></div> : null}
        {row.smtp_error_code ? <div><dt>错误代码</dt><dd><span className="mono">{row.smtp_error_code}</span></dd></div> : null}
      </dl>

      <SentMail row={row} />
      <p className="drawer__foot">时间均为北京时间。</p>
    </>
  );
}

/** 当时实际发出的那封邮件。从列表垫进来的数据没有这部分，详情读回来之后才显示。 */
function SentMail({ row }: { row: RequestDetail }) {
  const [view, setView] = useState<'html' | 'text'>('html');
  if (row.html_body === undefined || row.text_body === undefined) {
    return <div className="sent-mail"><Skeleton width="100%" height={280} /></div>;
  }
  return (
    <section className="sent-mail">
      <header className="sent-mail__head">
        <h3>发出的邮件</h3>
        <Tip>这是当时实际发出的原文，里面的验证码是真实的，发出 5 分钟后失效。</Tip>
        <Segmented label="正文版本" size="sm" value={view} onChange={setView} options={[{ value: 'html', label: 'HTML' }, { value: 'text', label: '纯文本' }]} />
      </header>
      <MailFrame fromName={row.from_name ?? ''} fromEmail={row.from_email} subject={row.subject ?? ''} to={row.email}>
        {view === 'html' ? <HtmlBody html={row.html_body} /> : <TextBody text={row.text_body} />}
      </MailFrame>
      {row.reply_to ? <p className="sent-mail__note">回复地址：<span className="mono">{row.reply_to}</span></p> : null}
    </section>
  );
}

const CHOICES = [
  { value: 'accepted', title: '确实发出了', detail: '服务商后台能查到这封邮件已被受理。计入已用 1 封。', done: '已按「确实发出了」结算，计入已用 1 封。' },
  { value: 'failed', title: '没有发出', detail: '服务商后台查不到，或显示被拒收。退回这 1 封额度，这封邮件里的验证码同时作废。', done: '已按「没有发出」结算，退回 1 封额度。' },
] as const;

/** 结果不明的记录在抽屉里就地结算：选结论、可选备注，提交前再确认一次。 */
function ResolvePanel({ row }: { row: RequestDetail }) {
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
      invalidate('requests', 'stats', 'tenants', 'tenant:');
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
