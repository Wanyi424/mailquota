import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { dateBoundary, dateTime, number } from '../helpers';
import type { Customer, RequestRow } from '../types';
import { Icon } from '../icons';
import { GuardedLink, useAdmin } from '../components/app';
import { Badge, EmptyState, Field, FormError, LoadingState, Modal, Pagination, copyText, explainError, useConfirm, useToast } from '../components/ui';

const STATUS_TABS: Array<[string, string]> = [['', '全部'], ['unknown', '待确认'], ['accepted', '已受理'], ['pending', '处理中'], ['failed', '未计费']];
type PageData = { total: number; page: number; page_size: number; items: RequestRow[] };
type Draft = { customer_id: string; email: string; from: string; to: string };

export function RecordsPage({ fixedCustomer = '', basePath = '/records' }: { fixedCustomer?: string; basePath?: string }) {
  const { api, refreshPendingBadge } = useAdmin();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [data, setData] = useState<PageData | null>(null);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [filterError, setFilterError] = useState<unknown>();
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [resolving, setResolving] = useState<RequestRow | null>(null);
  const [refresh, setRefresh] = useState(0);
  const queryKey = searchParams.toString();
  const values = useMemo(() => Object.fromEntries(searchParams.entries()), [queryKey]);
  const filters = useMemo(() => ({ page: Math.max(1, Number(values.page) || 1), page_size: 20, customer_id: fixedCustomer || values.customer_id || '', status: values.status || '', email: values.email || '', from: dateBoundary(values.from), to: dateBoundary(values.to, true) }), [fixedCustomer, values.customer_id, values.email, values.from, values.page, values.status, values.to]);
  const customerNames = useMemo(() => new Map(customers.map(customer => [customer.customer_id, customer.name])), [customers]);
  const [draft, setDraft] = useState<Draft>({ customer_id: values.customer_id || '', email: values.email || '', from: values.from || '', to: values.to || '' });

  useEffect(() => { setDraft({ customer_id: values.customer_id || '', email: values.email || '', from: values.from || '', to: values.to || '' }); setFilterError(undefined); }, [queryKey]);
  const buildRoute = (overrides: Record<string, string | number | undefined> = {}) => {
    const next = { ...values, ...overrides };
    const query = new URLSearchParams();
    for (const key of ['status', 'email', 'from', 'to', 'page', 'record']) if (next[key]) query.set(key, String(next[key]));
    if (!fixedCustomer && next.customer_id) query.set('customer_id', String(next.customer_id));
    return basePath + (query.size ? '?' + query.toString() : '');
  };

  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    const customerRequest = fixedCustomer ? Promise.resolve<Customer[]>([]) : api.customers(1, 100).then(result => result.items);
    Promise.all([customerRequest, api.requests(filters), filters.status === 'unknown' ? Promise.resolve(null) : api.requests({ status: 'unknown', page: 1, page_size: 1, customer_id: filters.customer_id || undefined })]).then(([all, result, pending]) => {
      if (!active) return;
      setCustomers(all); setData(result); setPendingTotal(filters.status === 'unknown' ? result.total : pending?.total || 0);
    }).catch(value => { if (active) setError(value); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, filters, fixedCustomer, location.search, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const recordId = Number(searchParams.get('record'));
    const row = data?.items.find(item => item.id === recordId);
    if (row) setSelected(row);
  }, [data, searchParams]);

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const fromValue = dateBoundary(draft.from);
      const toValue = dateBoundary(draft.to, true);
      if (fromValue !== undefined && toValue !== undefined && fromValue > toValue) throw new Error('开始日期不能晚于结束日期。');
      setFilterError(undefined);
      navigate(buildRoute({ page: 1, customer_id: draft.customer_id, email: draft.email, from: draft.from, to: draft.to, record: undefined }));
    } catch (value) { setFilterError(value); }
  };
  const reset = () => navigate(buildRoute({ customer_id: '', email: '', from: '', to: '', page: 1, record: undefined }));
  const openDetails = (row: RequestRow) => { setSelected(row); navigate(buildRoute({ record: row.id })); };
  const closeDetails = () => { setSelected(null); navigate(buildRoute({ record: undefined })); };
  const body = error && !data ? <div className="inline-error" role="alert"><p>{explainError(error)}</p><button className="button secondary" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh-cw" />重新加载</button></div> : loading && !data ? <LoadingState /> : !data || !data.items.length ? <><EmptyState message={filters.status === 'unknown' ? '暂无待确认记录' : '暂无符合条件的发送记录'} />{data ? <Pagination page={data.page} total={data.total} onChange={page => navigate(buildRoute({ page }))} /> : null}</> : <div className="table-wrap"><table><thead><tr><th>收件邮箱 / 请求编号</th>{fixedCustomer ? null : <th>客户</th>}<th>状态</th><th>额度处理</th><th>发送时间</th><th>操作</th></tr></thead><tbody>{data.items.map(row => <tr key={row.id}><td><span className="cell-stack">{row.email}<small className="mono request-id" title={row.request_id}>{row.request_id}</small></span></td>{fixedCustomer ? null : <td><span className="cell-stack">{customerNames.get(row.customer_id) || row.customer_id}<small className="mono">{row.customer_id}</small></span></td>}<td><Badge status={row.status} /></td><td className="muted">{row.status === 'accepted' ? '已计用量 1 封' : row.status === 'failed' ? '占用已释放' : '占用 1 封'}</td><td><span className="cell-stack">{dateTime(row.created_at)}<small>{row.resolved_at ? '已人工处理' : row.error_code || '—'}</small></span></td><td><div className="button-group"><button className="text-button" onClick={() => openDetails(row)}>详情</button>{row.status === 'unknown' ? <button className="button small secondary" onClick={() => setResolving(row)}>处理</button> : null}</div></td></tr>)}</tbody></table></div>;

  return <><section className={`panel${loading ? ' is-loading' : ''}`} aria-busy={loading}><nav className="status-tabs" aria-label="按发送状态筛选">{STATUS_TABS.map(([key, label]) => <GuardedLink key={key} to={buildRoute({ status: key, page: 1, record: undefined })} className={(filters.status === key ? 'active' : '') + (key === 'unknown' ? ' attention' : '')} aria-current={filters.status === key ? 'page' : undefined}>{label}{key === 'unknown' && pendingTotal ? <span className="tab-count">{number(pendingTotal)}</span> : null}</GuardedLink>)}</nav><form className={'filter-form' + (fixedCustomer ? ' compact' : '')} onSubmit={submitFilters}>{fixedCustomer ? null : <Field label="客户"><select name="customer_id" value={draft.customer_id} onChange={event => setDraft(current => ({ ...current, customer_id: event.target.value }))}><option value="">全部客户</option>{customers.map(customer => <option key={customer.customer_id} value={customer.customer_id}>{customer.name}</option>)}{draft.customer_id && !customerNames.has(draft.customer_id) ? <option value={draft.customer_id}>{draft.customer_id}</option> : null}</select></Field>}<Field label="收件邮箱"><input name="email" type="email" maxLength={254} value={draft.email} onChange={event => setDraft(current => ({ ...current, email: event.target.value }))} placeholder="精确匹配邮箱" /></Field><Field label="开始日期"><input name="from" type="date" min="1970-01-01" value={draft.from} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></Field><Field label="结束日期"><input name="to" type="date" min="1970-01-01" value={draft.to} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} /></Field><div className="filter-actions"><button type="submit" className="button primary small"><Icon name="sliders-horizontal" />筛选</button><button type="button" className="button quiet small" onClick={reset}>清空</button><button type="button" className="button secondary small icon-button" onClick={() => setRefresh(value => value + 1)} aria-label="刷新记录" title="刷新记录"><Icon name="refresh-cw" /></button></div><FormError error={filterError} /></form><div id="records-table">{body}{data && data.items.length ? <Pagination page={data.page} total={data.total} onChange={page => navigate(buildRoute({ page, record: undefined }))} /> : null}</div></section><footer className="page-footnote"><span>北京时间（UTC+8）</span></footer>{selected ? <DetailModal row={selected} names={customerNames} onClose={closeDetails} onResolve={() => { setSelected(null); setResolving(selected); }} /> : null}{resolving ? <ResolveModal row={resolving} names={customerNames} onClose={() => setResolving(null)} onDone={() => { setResolving(null); closeDetails(); void refreshPendingBadge(); setRefresh(value => value + 1); }} /> : null}</>;
}

function DetailModal({ row, names, onClose, onResolve }: { row: RequestRow; names: Map<string, string>; onClose: () => void; onResolve: () => void }) {
  const showToast = useToast();
  const customerName = names.get(row.customer_id) || row.customer_id;
  const entries: Array<[string, string]> = [['客户', customerName + '（' + row.customer_id + '）'], ['收件邮箱', row.email], ['请求编号', row.request_id], ['用户 IP', row.client_ip], ['发送时间', dateTime(row.created_at)], ['更新时间', dateTime(row.updated_at)], ['服务商消息 ID', row.provider_message_id || '—'], ['错误代码', row.error_code || '—'], ['诊断说明', row.error_detail || '—'], ['人工处理时间', dateTime(row.resolved_at)], ['处理管理员', row.resolved_by || '—'], ['处理依据', row.resolution_note || '—']];
  return <Modal title="发送详情" wide onClose={onClose}><div className="record-details"><div className="button-group"><Badge status={row.status} /><button className="button quiet small" onClick={event => void copyText(row.request_id, showToast, event.currentTarget)}><Icon name="copy" />复制请求编号</button></div><dl className="detail-list">{entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div><div className="dialog-actions"><button className="button secondary" onClick={onClose}>关闭</button>{row.status === 'unknown' ? <button className="button primary" onClick={onResolve}>处理这条记录</button> : null}</div></Modal>;
}

function ResolveModal({ row, names, onClose, onDone }: { row: RequestRow; names: Map<string, string>; onClose: () => void; onDone: () => void }) {
  const { api } = useAdmin();
  const confirm = useConfirm();
  const [status, setStatus] = useState<'accepted' | 'failed' | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!status || !note.trim()) { setError(new Error('请填写核查依据，不能只输入空格。')); return; }
    const customerName = names.get(row.customer_id) || row.customer_id;
    const description = status === 'accepted' ? '客户「' + customerName + '」的永久已用将增加 1 封。这不会重新发送邮件。' : '客户可用额度将恢复 1 封。这不会重新发送邮件，也不会恢复旧验证码。';
    if (!await confirm(status === 'accepted' ? '确认计入永久已用？' : '确认释放这次占用？', description, '确认处理', true)) return;
    setBusy(true); setError(undefined);
    try { await api.resolve(row.id, status, note.trim()); onDone(); } catch (value) { setError(value); } finally { setBusy(false); }
  };
  return <Modal title="确认这次发送的结果" subtitle="处理完成后不能撤销。" wide onClose={onClose}><div className="record-summary"><div><span>客户</span><strong>{names.get(row.customer_id) || row.customer_id}</strong></div><div><span>收件邮箱</span><strong>{row.email}</strong></div><div><span>当前占用</span><strong>1 封</strong></div><div><span>发送时间（北京时间）</span><strong>{dateTime(row.created_at)}</strong></div></div><form className="form-stack" onSubmit={submit}><FormError error={error} /><div className="resolve-choices"><label className="resolve-choice"><input type="radio" name="status" value="accepted" checked={status === 'accepted'} onChange={() => setStatus('accepted')} required /><span><strong>确认已受理</strong><small>占用减少 1 封，永久已用增加 1 封。</small></span></label><label className="resolve-choice"><input type="radio" name="status" value="failed" checked={status === 'failed'} onChange={() => setStatus('failed')} required /><span><strong>确认释放占用</strong><small>占用减少 1 封，客户可用额度恢复 1 封。</small></span></label></div><Field label="核查依据" help="必填，最多 2000 字。依据与管理员身份会保存在记录中。"><textarea value={note} onChange={event => setNote(event.target.value)} rows={4} maxLength={2000} required placeholder="例如：已在服务商控制台核对请求时间和收件邮箱，确认受理。" /></Field><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? '正在处理…' : '继续确认'}</button></div></form></Modal>;
}
