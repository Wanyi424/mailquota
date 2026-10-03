import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { dateBoundary, dateTime, number } from '../helpers';
import type { Customer, RequestRow } from '../types';
import { Icon } from '../icons';
import { GuardedLink, useAdmin } from '../components/app';
import { Badge, EmptyState, Field, FormError, LoadingState, Modal, Pagination, copyText, explainError, useConfirm, useToast } from '../components/ui';

const STATUS_TABS: Array<[string, string]> = [['', '全部'], ['unknown', '待确认'], ['accepted', '已受理'], ['pending', '处理中'], ['failed', '未计费']];

export function RecordsPage({ fixedCustomer = '', basePath = '/records' }: { fixedCustomer?: string; basePath?: string }) {
  const { api, refreshPendingBadge } = useAdmin();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [data, setData] = useState<{ total: number; page: number; page_size: number; items: RequestRow[] } | null>(null);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [resolving, setResolving] = useState<RequestRow | null>(null);
  const [refresh, setRefresh] = useState(0);
  const values = Object.fromEntries(searchParams.entries());
  const filters = useMemo(() => ({ page: Math.max(1, Number(values.page) || 1), page_size: 20, customer_id: fixedCustomer || values.customer_id || '', status: values.status || '', email: values.email || '', from: dateBoundary(values.from), to: dateBoundary(values.to, true) }), [fixedCustomer, values.email, values.from, values.page, values.status, values.to, values.customer_id]);
  const customerNames = useMemo(() => new Map(customers.map(customer => [customer.customer_id, customer.name])), [customers]);
  const buildRoute = (overrides: Record<string, string | number | undefined> = {}) => {
    const next = { ...values, ...overrides };
    const query = new URLSearchParams();
    for (const key of ['status', 'email', 'from', 'to', 'page']) if (next[key]) query.set(key, String(next[key]));
    if (!fixedCustomer && next.customer_id) query.set('customer_id', String(next.customer_id));
    return basePath + (query.size ? '?' + query.toString() : '');
  };
  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const first = await api.customers(1, 100);
      const all = [...first.items];
      for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) all.push(...(await api.customers(page, 100)).items);
      const result = await api.requests(filters);
      const pending = filters.status === 'unknown' ? result.total : (await api.requests({ status: 'unknown', page: 1, page_size: 1, customer_id: filters.customer_id || undefined })).total;
      setCustomers(all);
      setData(result);
      setPendingTotal(pending);
    } catch (value) { setError(value); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [location.search, fixedCustomer, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading) return <LoadingState />;
  if (error || !data) return <EmptyState message={explainError(error)} action={<button className="button secondary" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh-cw" />重新加载</button>} />;

  const submitFilters = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const from = String(form.get('from') || '');
    const to = String(form.get('to') || '');
    try {
      const fromValue = dateBoundary(from);
      const toValue = dateBoundary(to, true);
      if (fromValue !== undefined && toValue !== undefined && fromValue > toValue) throw new Error('开始日期不能晚于结束日期。');
      const next: Record<string, string> = { page: '1', email: String(form.get('email') || ''), from, to };
      if (!fixedCustomer) next.customer_id = String(form.get('customer_id') || '');
      navigate(buildRoute(next));
    } catch (value) {
      const area = event.currentTarget.querySelector<HTMLElement>('.form-error');
      if (area) { area.hidden = false; area.textContent = explainError(value); }
    }
  };
  const reset = () => navigate(buildRoute({ customer_id: '', email: '', from: '', to: '', page: 1 }));
  return <>{filters.status === 'unknown' && data.total ? <div className="notice warning"><Icon name="circle-help" /><span>{number(data.total)} 条待确认记录仍占用额度，请核查服务商结果后处理。</span></div> : null}<section className="panel"><nav className="status-tabs" aria-label="按发送状态筛选">{STATUS_TABS.map(([key, label]) => <GuardedLink key={key} to={buildRoute({ status: key, page: 1 })} className={(filters.status === key ? 'active' : '') + (key === 'unknown' ? ' attention' : '')} aria-current={filters.status === key ? 'page' : undefined}>{label}{key === 'unknown' && pendingTotal ? <span className="tab-count">{number(pendingTotal)}</span> : null}</GuardedLink>)}</nav><form className={'filter-form' + (fixedCustomer ? ' compact' : '')} onSubmit={submitFilters}>{fixedCustomer ? null : <Field label="客户"><select name="customer_id" defaultValue={filters.customer_id}><option value="">全部客户</option>{customers.map(customer => <option key={customer.customer_id} value={customer.customer_id}>{customer.name}</option>)}{filters.customer_id && !customerNames.has(filters.customer_id) ? <option value={filters.customer_id}>{filters.customer_id}</option> : null}</select></Field>}<Field label="收件邮箱"><input name="email" type="email" maxLength={254} defaultValue={values.email || ''} placeholder="精确匹配邮箱" /></Field><Field label="开始日期"><input name="from" type="date" min="1970-01-01" defaultValue={values.from || ''} /></Field><Field label="结束日期"><input name="to" type="date" min="1970-01-01" defaultValue={values.to || ''} /></Field><div className="filter-actions"><button type="submit" className="button primary small"><Icon name="sliders-horizontal" />筛选</button><button type="button" className="button quiet small" onClick={reset}>清空</button><button type="button" className="button secondary small icon-button" onClick={() => setRefresh(value => value + 1)} aria-label="刷新记录" title="刷新记录"><Icon name="refresh-cw" /></button></div><FormError /></form><div id="records-table">{!data.items.length ? <><EmptyState message={filters.status === 'unknown' ? '暂无待确认记录' : '暂无符合条件的发送记录'} /><Pagination page={data.page} total={data.total} onChange={page => navigate(buildRoute({ page }))} /></> : <><div className="table-wrap"><table><thead><tr><th>收件邮箱 / 请求编号</th>{fixedCustomer ? null : <th>客户</th>}<th>状态</th><th>额度处理</th><th>发送时间</th><th>操作</th></tr></thead><tbody>{data.items.map(row => <tr key={row.id}><td><span className="cell-stack">{row.email}<small className="mono request-id" title={row.request_id}>{row.request_id}</small></span></td>{fixedCustomer ? null : <td><span className="cell-stack">{customerNames.get(row.customer_id) || row.customer_id}<small className="mono">{row.customer_id}</small></span></td>}<td><Badge status={row.status} /></td><td className="muted">{row.status === 'accepted' ? '已计用量 1 封' : row.status === 'failed' ? '占用已释放' : '占用 1 封'}</td><td><span className="cell-stack">{dateTime(row.created_at)}<small>{row.resolved_at ? '已人工处理' : row.error_code || '—'}</small></span></td><td><div className="button-group"><button className="text-button" onClick={() => setSelected(row)}>详情</button>{row.status === 'unknown' ? <button className="button small secondary" onClick={() => setResolving(row)}>处理</button> : null}</div></td></tr>)}</tbody></table></div><Pagination page={data.page} total={data.total} onChange={page => navigate(buildRoute({ page }))} /></>}</div></section><footer className="page-footnote"><span>北京时间（UTC+8）</span></footer>{selected ? <DetailModal row={selected} names={customerNames} onClose={() => setSelected(null)} onResolve={() => { setSelected(null); setResolving(selected); }} /> : null}{resolving ? <ResolveModal row={resolving} names={customerNames} onClose={() => setResolving(null)} onDone={() => { setResolving(null); void refreshPendingBadge(); setRefresh(value => value + 1); }} /> : null}</>;
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
  return <Modal title="确认这次发送的结果" subtitle="请先核查服务商的受理记录。处理完成后不能在此撤销。" wide onClose={onClose}><div className="record-summary"><div><span>客户</span><strong>{names.get(row.customer_id) || row.customer_id}</strong></div><div><span>收件邮箱</span><strong>{row.email}</strong></div><div><span>当前占用</span><strong>1 封</strong></div><div><span>发送时间（北京时间）</span><strong>{dateTime(row.created_at)}</strong></div></div><form className="form-stack" onSubmit={submit}><FormError error={error} /><div className="resolve-choices"><label className="resolve-choice"><input type="radio" name="status" value="accepted" checked={status === 'accepted'} onChange={() => setStatus('accepted')} required /><span><strong>确认已受理</strong><small>占用减少 1 封，永久已用增加 1 封。</small></span></label><label className="resolve-choice"><input type="radio" name="status" value="failed" checked={status === 'failed'} onChange={() => setStatus('failed')} required /><span><strong>确认释放占用</strong><small>占用减少 1 封，客户可用额度恢复 1 封。</small></span></label></div><Field label="核查依据" help="必填，最多 2000 字。依据与管理员身份会保存在记录中。"><textarea value={note} onChange={event => setNote(event.target.value)} rows={4} maxLength={2000} required placeholder="例如：已在服务商控制台核对请求时间和收件邮箱，确认受理。" /></Field><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? '正在处理…' : '继续确认'}</button></div></form></Modal>;
}
