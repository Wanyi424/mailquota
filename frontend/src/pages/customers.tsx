import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { customerLink, customerRecordsLink, number, quotaTarget, templateLink } from '../helpers';
import type { AdminApi, Customer } from '../types';
import { Icon } from '../icons';
import { useAdmin, GuardedLink } from '../components/app';
import { Badge, EmptyState, Field, FormError, LoadingState, Modal, Pagination, copyText, explainError, useConfirm, useToast } from '../components/ui';
import { defaultTemplate, defaultText } from '../default-template';
import { TemplateTab } from './templates';
import { RecordsPage } from './records';

const LOW_QUOTA_RATIO = 0.1;
const isLow = (customer: Customer) => customer.enabled && customer.quota_total > 0 && customer.available_count / customer.quota_total <= LOW_QUOTA_RATIO;

export function Metrics({ quota_total = 0, used_count = 0, reserved_count = 0, available_count = 0 }: Pick<Customer, 'quota_total' | 'used_count' | 'reserved_count' | 'available_count'>) {
  const occupied = used_count + reserved_count;
  const low = quota_total > 0 && available_count / quota_total <= LOW_QUOTA_RATIO;
  const usage = quota_total > 0 ? <><div className={`usage-track slim ${low ? 'low' : ''}`}><progress value={occupied} max={quota_total} aria-label="已用与占用额度" /></div><div className="metric-sub">已用与占用 {number(occupied)} / {number(quota_total)} 封</div></> : null;
  return <section className="metrics" aria-label="永久额度"><div className="metric"><div className="metric-label">可用额度</div><div className="metric-value teal">{number(available_count)}<small>封</small></div>{usage}</div><div className="metric"><div className="metric-label">永久已用</div><div className="metric-value">{number(used_count)}<small>封</small></div></div><div className="metric"><div className="metric-label">发送占用</div><div className={`metric-value ${reserved_count ? 'amber' : ''}`}>{number(reserved_count)}<small>封</small></div></div><div className="metric"><div className="metric-label">永久总额度</div><div className="metric-value">{number(quota_total)}<small>封</small></div></div></section>;
}

async function loadAllCustomers(api: AdminApi) {
  const first = await api.customers(1, 100);
  const items = [...first.items];
  for (let page = 2; page <= Math.ceil(first.total / 100); page += 1) items.push(...(await api.customers(page, 100)).items);
  return items;
}

export function CustomersPage() {
  const { api, setCrumbs } = useAdmin();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [page, setPage] = useState(1);
  const totals = useMemo(() => customers.reduce((sum, customer) => ({ quota_total: sum.quota_total + customer.quota_total, used_count: sum.used_count + customer.used_count, reserved_count: sum.reserved_count + customer.reserved_count, available_count: sum.available_count + customer.available_count }), { quota_total: 0, used_count: 0, reserved_count: 0, available_count: 0 }), [customers]);
  const rows = useMemo(() => customers.filter(customer => `${customer.name} ${customer.customer_id}`.toLowerCase().includes(search.trim().toLowerCase())), [customers, search]);

  useEffect(() => { setCrumbs([{ label: '客户管理' }]); }, [setCrumbs]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(undefined);
    loadAllCustomers(api).then(value => { if (active) setCustomers(value); }).catch(value => { if (active) setError(value); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, refresh]);
  useEffect(() => { setPage(current => Math.min(current, Math.max(1, Math.ceil(rows.length / 20)))); }, [rows.length]);

  if (loading) return <LoadingState />;
  if (error) return <EmptyState message={explainError(error)} action={<button className="button secondary" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh-cw" />重新加载</button>} />;
  return <><Metrics {...totals} /><section className="panel" aria-label="客户列表"><div className="collection-toolbar"><div className="search-field"><Icon name="search" /><input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="搜索客户名称或 ID" aria-label="搜索客户名称或 ID" autoComplete="off" /></div><span className="toolbar-count">{number(customers.length)} 位客户 · {number(customers.filter(customer => customer.enabled).length)} 位已启用</span><div className="toolbar-actions"><button className="button secondary icon-button" onClick={() => setRefresh(value => value + 1)} aria-label="刷新客户" title="刷新客户"><Icon name="refresh-cw" /></button><button className="button primary" onClick={() => setCreateOpen(true)}><Icon name="plus" />新建客户</button></div></div><div id="customer-table">{rows.length === 0 ? <EmptyState message={customers.length ? '没有匹配的客户' : '暂无客户'} /> : <><div className="table-wrap"><table><thead><tr><th>客户昵称</th><th>客户 ID</th><th>状态</th><th className="numeric">可用额度</th><th className="numeric">永久已用</th><th className="numeric">占用</th><th className="numeric">总额度</th><th>操作</th></tr></thead><tbody>{rows.slice((page - 1) * 20, page * 20).map(customer => <tr key={customer.customer_id}><td><div className="customer-title"><span className="customer-initial" aria-hidden="true">{[...customer.name][0]}</span><GuardedLink className="customer-name" to={customerLink(customer.customer_id)}>{customer.name}</GuardedLink></div></td><td><span className="mono mono-cell">{customer.customer_id}</span></td><td><Badge status={customer.enabled ? 'enabled' : 'disabled'} /></td><td className={`numeric available ${isLow(customer) ? 'low' : ''}`}>{number(customer.available_count)}</td><td className="numeric">{number(customer.used_count)}</td><td className="numeric">{number(customer.reserved_count)}</td><td className="numeric muted">{number(customer.quota_total)}</td><td><div className="button-group"><GuardedLink className="text-button" to={customerLink(customer.customer_id)}>管理</GuardedLink><GuardedLink className="button quiet small" to={templateLink(customer.customer_id)}>邮件模板</GuardedLink></div></td></tr>)}</tbody></table></div><Pagination page={page} total={rows.length} onChange={setPage} /></>}</div></section>{createOpen ? <CreateCustomerModal onClose={() => setCreateOpen(false)} onCreated={() => { setRefresh(value => value + 1); }} /> : null}</>;
}

function CreateCustomerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (customer: Customer) => void }) {
  const { api, guardedNavigate } = useAdmin();
  const showToast = useToast();
  const [values, setValues] = useState({ name: '', customer_id: '', from_name: '', quota_total: '0', subject: '邮箱验证码' });
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<Customer | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setError(undefined); setBusy(true);
    try {
      const quota = Number(values.quota_total);
      if (!Number.isSafeInteger(quota) || quota < 0) throw new Error('初始额度必须是非负安全整数。');
      const customer = await api.createCustomer({ name: values.name.trim(), customer_id: values.customer_id, from_name: values.from_name.trim(), subject: values.subject.trim(), quota_total: quota, enabled: false, reply_to: '', text_template: defaultText, html: defaultTemplate });
      onCreated(customer); showToast('客户已创建，当前为停用状态。'); setSecret(customer);
    } catch (submitError) { setError(submitError); }
    finally { setBusy(false); }
  };
  if (secret) return <SecretModal customer={secret} onClose={() => { setSecret(null); onClose(); }} onDone={() => { setSecret(null); void guardedNavigate(customerLink(secret.customer_id)); }} />;
  return <Modal title="新建客户" subtitle="创建后默认停用，可在详情中启用。" wide onClose={onClose}><form className="form-stack" onSubmit={submit}><FormError error={error} /><div className="form-grid"><Field label="客户名称"><input value={values.name} onChange={event => setValues({ ...values, name: event.target.value })} required maxLength={200} placeholder="例如：星河工作室" autoComplete="off" /></Field><Field label="客户 ID" help="仅字母、数字、下划线或短横线，创建后不可修改。"><input value={values.customer_id} onChange={event => setValues({ ...values, customer_id: event.target.value })} required pattern="[A-Za-z0-9_-]{1,64}" maxLength={64} placeholder="例如：xinghe" autoComplete="off" spellCheck={false} /></Field><Field label="发件昵称"><input value={values.from_name} onChange={event => setValues({ ...values, from_name: event.target.value })} required maxLength={100} placeholder="收件人看到的发件名称" /></Field><Field label="初始总额度"><input value={values.quota_total} onChange={event => setValues({ ...values, quota_total: event.target.value })} required type="number" min="0" max="9007199254740991" step="1" /></Field><div className="span-full"><Field label="邮件标题"><input value={values.subject} onChange={event => setValues({ ...values, subject: event.target.value })} required maxLength={200} /></Field></div></div><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy}><Icon name="plus" />{busy ? '正在创建…' : '创建客户'}</button></div></form></Modal>;
}

function SecretModal({ customer, onClose, onDone }: { customer: Customer; onClose: () => void; onDone: () => void }) {
  const showToast = useToast();
  return <Modal title="保存客户调用密钥" subtitle="完整密钥仅在此显示一次。关闭前请妥善保存，并仅配置到客户后端。" secret onClose={onClose}><dl className="detail-list"><div><dt>客户 ID</dt><dd className="mono">{customer.customer_id}</dd></div><div><dt>服务地址</dt><dd className="mono">{location.origin}</dd></div></dl><Field label="API 密钥"><textarea className="secret-value mono" rows={3} readOnly spellCheck={false} value={customer.api_key || ''} /></Field><div className="dialog-actions"><button className="button secondary" onClick={event => void copyText(customer.api_key || '', showToast, event.currentTarget)}><Icon name="copy" />复制密钥</button><button className="button primary" onClick={onDone}>我已保存，关闭</button></div></Modal>;
}

export function CustomerDetailPage({ tab }: { tab: 'overview' | 'template' | 'records' }) {
  const { id = '' } = useParams();
  const { api, setCrumbs } = useAdmin();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError(undefined);
    api.customer(id).then(value => { if (active) { setCustomer(value); setCrumbs(tab === 'overview' ? [{ label: '客户管理', to: '/customers' }, { label: value.name }] : [{ label: '客户管理', to: '/customers' }, { label: value.name, to: customerLink(id) }, { label: tab === 'template' ? '邮件模板' : '发送记录' }]); }}).catch(value => { if (active) setError(value); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, id, refresh, setCrumbs, tab]);
  if (loading) return <LoadingState />;
  if (error || !customer) return <EmptyState message={(error as { code?: string })?.code === 'CUSTOMER_NOT_FOUND' ? '客户不存在' : explainError(error)} action={<button className="button secondary" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh-cw" />重新加载</button>} />;
  const tabs = [{ key: 'overview', label: '概览', to: customerLink(id) }, { key: 'template', label: '邮件模板', to: templateLink(id) }, { key: 'records', label: '发送记录', to: customerRecordsLink(id) }] as const;
  return <><header className="page-head"><div className="identity"><span className="customer-initial" aria-hidden="true">{[...customer.name][0]}</span><div><h1>{customer.name}<Badge status={customer.enabled ? 'enabled' : 'disabled'} /></h1><div className="head-sub"><span className="mono">{customer.customer_id}</span></div></div></div><CustomerHeadActions customer={customer} onRefresh={() => setRefresh(value => value + 1)} /></header><nav className="tabs" aria-label="客户详情栏目">{tabs.map(item => <GuardedLink key={item.key} to={item.to} className={item.key === tab ? 'active' : undefined}>{item.label}</GuardedLink>)}</nav>{tab === 'overview' ? <OverviewTab customer={customer} onRefresh={() => setRefresh(value => value + 1)} /> : tab === 'template' ? <TemplateTab customer={customer} onRefresh={() => setRefresh(value => value + 1)} /> : <RecordsPage fixedCustomer={id} basePath={customerRecordsLink(id)} />}</>;
}

function CustomerHeadActions({ customer, onRefresh }: { customer: Customer; onRefresh: () => void }) {
  const { api } = useAdmin();
  const confirm = useConfirm();
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const changeEnabled = async () => {
    if (!await confirm(customer.enabled ? '停用这位客户？' : '启用这位客户？', customer.enabled ? '停用后，该客户的发送、核验和查询接口均不可调用。已经开始的发送仍会正常结算。' : `启用后客户可使用 ID 和密钥调用服务，当前可用额度为 ${number(customer.available_count)} 封。`, customer.enabled ? '确认停用' : '确认启用', customer.enabled)) return;
    setBusy(true); try { await api.setEnabled(customer.customer_id, customer.version, !customer.enabled); showToast(customer.enabled ? '客户已停用。' : '客户已启用。'); onRefresh(); } catch (error) { showToast(explainError(error), 'error'); } finally { setBusy(false); }
  };
  return <div className="head-actions"><button className="button secondary icon-button" onClick={onRefresh} aria-label="刷新客户信息" title="刷新客户信息"><Icon name="refresh-cw" /></button><button className={`button ${customer.enabled ? 'secondary danger-text' : 'primary'}`} onClick={() => void changeEnabled()} disabled={busy}><Icon name="power" />{customer.enabled ? '停用' : '启用'}</button><QuotaModalTrigger customer={customer} onSaved={onRefresh} /></div>;
}

function QuotaModalTrigger({ customer, onSaved }: { customer: Customer; onSaved: () => void }) {
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  return <>{open ? <QuotaModal customer={customer} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); showToast('永久额度已增加。'); onSaved(); }} /> : null}<button className="button primary" onClick={() => setOpen(true)}><Icon name="plus" />增加额度</button></>;
}

function QuotaModal({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: () => void }) {
  const { api } = useAdmin();
  const [increase, setIncrease] = useState(''); const [error, setError] = useState<unknown>(); const [busy, setBusy] = useState(false);
  const target = (() => { try { return `${number(quotaTarget(customer.quota_total, increase))} 封`; } catch { return '请输入有效增加量'; } })();
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(undefined); setBusy(true); try { await api.setQuota(customer.customer_id, customer.version, quotaTarget(customer.quota_total, increase)); onSaved(); } catch (value) { setError(value); } finally { setBusy(false); } };
  return <Modal title="增加永久额度" subtitle={`为「${customer.name}」增加可用发送次数。`} onClose={onClose}><form onSubmit={submit}>{<FormError error={error} />}<Field label="本次增加（封）"><input value={increase} onChange={event => setIncrease(event.target.value)} type="number" min="1" max="9007199254740991" step="1" required placeholder="输入增加量，例如 1000" /></Field><div className="quota-equation">当前总额度 {number(customer.quota_total)} 封<span className="cell-stack">保存后的总额度</span><strong>{target}</strong></div><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? '正在保存…' : '保存额度'}</button></div></form></Modal>;
}

function OverviewTab({ customer, onRefresh }: { customer: Customer; onRefresh: () => void }) {
  const low = isLow(customer);
  return <>{<Metrics {...customer} />}{!customer.enabled ? <div className="notice">客户已停用，发送、核验和查询均不可用。</div> : customer.available_count === 0 ? <div className="notice danger">可用额度已耗尽；已发送的有效验证码仍可核验。</div> : low ? <div className="notice warning"><Icon name="triangle-alert" /><span>可用额度不足总额度的 10%，建议尽快补充。</span></div> : null}<div className="detail-layout"><MailInfoPanel customer={customer} onRefresh={onRefresh} /><AccessPanel customer={customer} onRefresh={onRefresh} /></div></>;
}

function MailInfoPanel({ customer, onRefresh }: { customer: Customer; onRefresh: () => void }) {
  const { api } = useAdmin(); const showToast = useToast();
  const [editing, setEditing] = useState<'name' | 'from_name' | 'subject' | 'reply_to' | null>(null);
  const config = editing === 'name' ? { label: '客户名称', value: customer.name, help: '仅修改内部管理名称，不影响发件昵称或客户 ID。', attrs: { required: true, maxLength: 200 } } : editing === 'from_name' ? { label: '发件昵称', value: customer.from_name, help: '收件人看到的发件名称；实际发信地址由服务端统一配置。', attrs: { required: true, maxLength: 100 } } : editing === 'subject' ? { label: '邮件标题', value: customer.subject, help: '标题为静态文本，不执行模板变量。', attrs: { required: true, maxLength: 200 } } : editing === 'reply_to' ? { label: '回复邮箱', value: customer.reply_to, help: '收件人回复时投递的地址。', attrs: { maxLength: 254, type: 'email' } } : null;
  const save = async (value: string) => {
    if (!editing) return;
    if (editing === 'name') { await api.rename(customer.customer_id, customer.version, value.trim()); }
    else { const merged = { from_name: customer.from_name, subject: customer.subject, reply_to: customer.reply_to, text_template: customer.text_template, [editing]: value.trim() }; if (/[^\x20-\x7e\u4e00-\u9fff]/.test('')) void 0; if (!merged.from_name || !merged.subject || /[\x00-\x1f\x7f]/.test(merged.from_name) || /[\x00-\x1f\x7f]/.test(merged.subject)) throw new Error('发件昵称和标题不能包含换行或控制字符。'); await api.saveMail(customer.customer_id, customer.version, merged); }
    setEditing(null); showToast(`${config?.label || '客户名称'}已保存。`); onRefresh();
  };
  return <><section className="panel"><div className="panel-heading"><div className="panel-title"><h2>客户信息</h2></div></div><div className="panel-body"><dl className="detail-list"><div><dt>客户名称</dt><dd className="inline-edit"><span>{customer.name}</span><button className="button quiet small icon-button" onClick={() => setEditing('name')} aria-label="编辑客户名称" title="编辑客户名称"><Icon name="pencil" /></button></dd></div><div><dt>发件昵称</dt><dd className="inline-edit"><span>{customer.from_name}</span><button className="button quiet small icon-button" onClick={() => setEditing('from_name')} aria-label="编辑发件昵称" title="编辑发件昵称"><Icon name="pencil" /></button></dd></div><div><dt>邮件标题</dt><dd className="inline-edit"><span>{customer.subject}</span><button className="button quiet small icon-button" onClick={() => setEditing('subject')} aria-label="编辑邮件标题" title="编辑邮件标题"><Icon name="pencil" /></button></dd></div><div><dt>回复邮箱</dt><dd className="inline-edit"><span>{customer.reply_to || '未单独设置'}</span><button className="button quiet small icon-button" onClick={() => setEditing('reply_to')} aria-label="编辑回复邮箱" title="编辑回复邮箱"><Icon name="pencil" /></button></dd></div><div><dt>邮件样式</dt><dd><GuardedLink to={templateLink(customer.customer_id)}>在「邮件模板」栏目中编辑 HTML 与纯文本</GuardedLink></dd></div></dl></div></section>{editing && config ? <EditValueModal config={config} onClose={() => setEditing(null)} onSave={save} /> : null}</>;
}

function EditValueModal({ config, onClose, onSave }: { config: { label: string; value: string; help: string; attrs: Record<string, unknown> }; onClose: () => void; onSave: (value: string) => Promise<void> }) {
  const [value, setValue] = useState(config.value); const [error, setError] = useState<unknown>(); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(undefined); setBusy(true); try { await onSave(value); } catch (submitError) { setError(submitError); } finally { setBusy(false); } };
  return <Modal title={`编辑${config.label}`} subtitle={config.help} onClose={onClose}><form onSubmit={submit}><FormError error={error} /><Field label={config.label}><input value={value} onChange={event => setValue(event.target.value)} {...config.attrs} /></Field><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? '正在保存…' : '保存'}</button></div></form></Modal>;
}

function AccessPanel({ customer, onRefresh }: { customer: Customer; onRefresh: () => void }) {
  const showToast = useToast();
  const envSnippet = `MAILQUOTA_BASE_URL=${location.origin}\nMAILQUOTA_CUSTOMER_ID=${customer.customer_id}\nMAILQUOTA_API_KEY=<客户调用密钥>`;
  return <section className="panel"><div className="panel-heading"><div className="panel-title"><h2>接入配置</h2></div><ResetKeyButton customer={customer} onRefresh={onRefresh} /></div><div className="panel-body"><dl className="detail-list"><div><dt>服务地址</dt><dd className="inline-edit"><span className="mono">{location.origin}</span><button className="button quiet small icon-button" onClick={event => void copyText(location.origin, showToast, event.currentTarget)} aria-label="复制服务地址" title="复制服务地址"><Icon name="copy" /></button></dd></div><div><dt>客户 ID</dt><dd className="inline-edit"><span className="mono">{customer.customer_id}</span><button className="button quiet small icon-button" onClick={event => void copyText(customer.customer_id, showToast, event.currentTarget)} aria-label="复制客户 ID" title="复制客户 ID"><Icon name="copy" /></button></dd></div><div><dt>API 密钥</dt><dd className="inline-edit"><span className="mono masked-key">{customer.api_key_mask}</span><span className="muted" style={{ fontSize: 11 }}>完整密钥仅创建或重置时显示一次</span></dd></div></dl><div className="copy-block" style={{ marginTop: 18 }}><pre className="inline-code">{envSnippet}</pre><button className="button quiet small icon-button copy-fab" onClick={event => void copyText(envSnippet, showToast, event.currentTarget)} aria-label="复制环境变量" title="复制环境变量"><Icon name="copy" /></button></div></div></section>;
}

function ResetKeyButton({ customer, onRefresh }: { customer: Customer; onRefresh: () => void }) {
  const { api } = useAdmin(); const confirm = useConfirm(); const showToast = useToast(); const [secret, setSecret] = useState<Customer | null>(null); const [busy, setBusy] = useState(false);
  const reset = async () => { if (!await confirm('重置客户调用密钥？', '旧密钥将立即失效。请在生成后保存新密钥，并同步更新客户后端配置。额度与历史记录保持不变。', '确认重置', true)) return; setBusy(true); try { setSecret(await api.resetKey(customer.customer_id, customer.version)); } catch (error) { showToast(explainError(error), 'error'); } finally { setBusy(false); } };
  return <>{secret ? <SecretModal customer={secret} onClose={() => setSecret(null)} onDone={() => { setSecret(null); onRefresh(); }} /> : null}<button className="button secondary small" onClick={() => void reset()} disabled={busy}><Icon name="key-round" />重置密钥</button></>;
}
