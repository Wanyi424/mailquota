import { escapeHtml as e, number, customerLink, templateLink, quotaTarget } from '../helpers.js';
import { $, $$, badge, field, input, formError, empty, pagination, modal, bindSubmit, onClick, confirmDialog, showToast, revealKey, copyText } from '../ui.js';
import { defaultTemplate, defaultText } from '../default-template.js';
import { icon } from '../icons.js';

export function metrics({ quota_total = 0, used_count = 0, reserved_count = 0, available_count = 0 }) {
  return `<section class="metrics" aria-label="永久额度"><div class="metric"><div class="metric-label">可用额度</div><div class="metric-value accent">${number(available_count)}<small>封</small></div></div><div class="metric"><div class="metric-label">永久已用</div><div class="metric-value">${number(used_count)}<small>封</small></div></div><div class="metric"><div class="metric-label">发送占用</div><div class="metric-value ${reserved_count ? 'amber' : ''}">${number(reserved_count)}<small>封</small></div></div><div class="metric"><div class="metric-label">永久总额度</div><div class="metric-value">${number(quota_total)}<small>封</small></div></div></section>`;
}

export async function customersPage(ctx) {
  const customers = await ctx.allCustomers(); if (!ctx.active()) return;
  const totals = customers.reduce((sum, c) => { for (const key of Object.keys(sum)) sum[key] += c[key]; return sum; }, { quota_total: 0, used_count: 0, reserved_count: 0, available_count: 0 });
  ctx.root.innerHTML = metrics(totals) +
    `<section class="panel" aria-label="客户列表"><div class="collection-toolbar"><div class="search-field">${icon('search')}<input type="search" id="customer-search" placeholder="搜索客户名称或 ID" aria-label="搜索客户名称或 ID" autocomplete="off"></div><span class="toolbar-count">${number(customers.length)} 位客户 · ${number(customers.filter(c => c.enabled).length)} 位已启用</span><div class="toolbar-actions"><button class="button secondary icon-button" data-refresh aria-label="刷新客户" title="刷新客户">${icon('refresh-cw')}</button><button class="button primary" data-create>${icon('plus')}新建客户</button></div></div><div id="customer-table"></div></section>`;
  onClick(ctx.root, '[data-create]', () => createCustomer(ctx));
  onClick(ctx.root, '[data-refresh]', () => ctx.refresh());
  let page = 1;
  function renderTable() {
    const query = $('#customer-search', ctx.root).value.trim().toLowerCase();
    const rows = customers.filter(c => `${c.name} ${c.customer_id}`.toLowerCase().includes(query));
    const root = $('#customer-table', ctx.root);
    if (!rows.length) {
      root.innerHTML = empty(customers.length ? '没有匹配的客户' : '暂无客户'); return;
    }
    page = Math.min(page, Math.ceil(rows.length / 20));
    root.innerHTML = `<div class="table-wrap"><table><thead><tr><th>客户</th><th>状态</th><th class="numeric">可用额度</th><th class="numeric">永久已用</th><th class="numeric">占用</th><th class="numeric">总额度</th><th>操作</th></tr></thead><tbody>${rows.slice((page - 1) * 20, page * 20).map(c => `<tr><td><div class="customer-title"><span class="customer-initial" aria-hidden="true">${e([...c.name][0])}</span><div><a class="customer-name" href="${customerLink(c.customer_id)}">${e(c.name)}</a><span class="customer-id mono">${e(c.customer_id)}</span></div></div></td><td>${badge(c.enabled ? 'enabled' : 'disabled')}</td><td class="numeric available">${number(c.available_count)}</td><td class="numeric">${number(c.used_count)}</td><td class="numeric">${number(c.reserved_count)}</td><td class="numeric muted">${number(c.quota_total)}</td><td><div class="button-group"><a class="text-button" href="${customerLink(c.customer_id)}">管理</a><a class="button quiet small" href="${templateLink(c.customer_id)}">邮件模板</a></div></td></tr>`).join('')}</tbody></table></div>${pagination(page, rows.length)}`;
    onClick(root, '[data-page]', (_, node) => { page = Number(node.dataset.page); renderTable(); });
  }
  $('#customer-search', ctx.root).addEventListener('input', () => { page = 1; renderTable(); }); renderTable();
}

function createCustomer(ctx) {
  const view = modal('新建客户', '创建后默认停用，可在详情中启用。', `<form class="form-stack">${formError}<div class="form-grid">${field('客户名称', input('name', '', 'required maxlength="200" placeholder="例如：星河工作室" autocomplete="off"'))}${field('客户 ID', input('customer_id', '', 'required pattern="[A-Za-z0-9_-]{1,64}" maxlength="64" placeholder="例如：xinghe" autocomplete="off" spellcheck="false"'), '仅字母、数字、下划线或短横线，创建后不可修改。')}${field('发件昵称', input('from_name', '', 'required maxlength="100" placeholder="收件人看到的发件名称"'))}${field('初始总额度', input('quota_total', '0', 'required type="number" min="0" max="9007199254740991" step="1"'))}<div class="span-full">${field('邮件标题', input('subject', '邮箱验证码', 'required maxlength="200"'))}</div></div><div class="dialog-actions"><button type="button" class="button secondary" data-close>取消</button><button type="submit" class="button primary">${icon('plus')}创建客户</button></div></form>`, { wide: true });
  bindSubmit(view.form, async values => {
    const quota = Number(values.quota_total);
    if (!Number.isSafeInteger(quota) || quota < 0) throw new Error('初始额度必须是非负安全整数。');
    const c = await ctx.api.createCustomer({ name: values.name.trim(), customer_id: values.customer_id, from_name: values.from_name.trim(), subject: values.subject.trim(), quota_total: quota, enabled: false, reply_to: '', text_template: defaultText, html: defaultTemplate });
    view.close(); showToast('客户已创建，当前为停用状态。');
    revealKey(c, () => { void ctx.navigate(customerLink(c.customer_id)); });
  });
}

export async function customerPage(ctx, id) {
  const c = await ctx.api.customer(id); if (!ctx.active()) return;
  ctx.setBreadcrumb(c.name);
  const occupied = c.used_count + c.reserved_count;
  ctx.root.innerHTML = metrics(c) + (!c.enabled ? '<div class="notice">客户已停用，发送、核验和查询均不可用。</div>' : c.available_count === 0 ? '<div class="notice warning">可用额度已耗尽；已发送的有效验证码仍可核验。</div>' : '') +
    `<div class="detail-layout"><div class="section-stack"><section class="panel"><div class="panel-heading"><div class="panel-title"><h2>客户信息</h2>${badge(c.enabled ? 'enabled' : 'disabled')}</div><div class="button-group"><button class="button quiet icon-button" data-refresh aria-label="刷新客户信息" title="刷新客户信息">${icon('refresh-cw')}</button><button class="button small ${c.enabled ? 'secondary danger-text' : 'primary'}" data-enabled>${icon('power')}${c.enabled ? '停用' : '启用'}</button></div></div><div class="panel-body"><dl class="detail-list"><div><dt>客户名称</dt><dd class="inline-edit"><span>${e(c.name)}</span><button class="button quiet small icon-button" data-rename aria-label="编辑客户名称" title="编辑客户名称">${icon('pencil')}</button></dd></div><div><dt>客户 ID</dt><dd class="inline-edit"><span class="mono">${e(c.customer_id)}</span><button class="button quiet small icon-button" data-copy-id aria-label="复制客户 ID" title="复制客户 ID">${icon('copy')}</button></dd></div><div><dt>发件昵称</dt><dd>${e(c.from_name)}</dd></div><div><dt>邮件标题</dt><dd>${e(c.subject)}</dd></div><div><dt>回复邮箱</dt><dd>${e(c.reply_to || '未单独设置')}</dd></div><div><dt>邮件样式</dt><dd><a href="${templateLink(id)}">编辑该客户的邮件模板</a></dd></div></dl></div></section><section class="panel"><div class="panel-heading"><h2>接入凭据</h2></div><div class="panel-body"><div class="security-row"><span class="mono masked-key">${e(c.api_key_mask)}</span><button class="button secondary small" data-reset-key>${icon('key-round')}重置密钥</button></div><pre class="inline-code">MAILQUOTA_BASE_URL=${e(location.origin)}
MAILQUOTA_CUSTOMER_ID=${e(id)}
MAILQUOTA_API_KEY=&lt;客户调用密钥&gt;</pre></div></section></div><aside class="section-stack"><section class="panel"><div class="panel-heading"><h2>额度管理</h2></div><div class="panel-body"><span class="metric-label">当前可用</span><div class="quota-number">${number(c.available_count)}</div><div class="usage-track"><progress value="${occupied}" max="${Math.max(c.quota_total, 1)}" aria-label="已用与占用额度"></progress></div><p class="usage-legend">已用与占用 ${number(occupied)} / ${number(c.quota_total)} 封</p><button class="button primary full-width" data-quota>${icon('plus')}增加额度</button></div></section><section class="panel quick-links" aria-label="相关记录"><a href="#/requests?customer_id=${encodeURIComponent(id)}">${icon('send')}发送记录${icon('chevron-right')}</a><a href="#/pending?customer_id=${encodeURIComponent(id)}">${icon('circle-help')}待确认记录${icon('chevron-right')}</a></section></aside></div>`;
  onClick(ctx.root, '[data-refresh]', () => ctx.refresh());
  onClick(ctx.root, '[data-copy-id]', (_, node) => copyText(id, node));
  onClick(ctx.root, '[data-rename]', () => {
    const view = modal('编辑客户名称', '仅修改内部管理名称，不影响发件昵称或客户 ID。', `<form>${formError}${field('客户名称', input('name', c.name, 'required maxlength="200"'))}<div class="dialog-actions"><button type="button" class="button secondary" data-close>取消</button><button class="button primary" type="submit">保存名称</button></div></form>`);
    bindSubmit(view.form, async values => { await ctx.api.rename(id, c.version, values.name.trim()); view.close(); showToast('客户名称已保存。'); await ctx.refresh(); });
  });
  onClick(ctx.root, '[data-quota]', () => {
    const view = modal('增加永久额度', `为「${c.name}」增加可用发送次数。`, `<form>${formError}${field('本次增加（封）', input('increase', '', 'type="number" min="1" max="9007199254740991" step="1" required placeholder="输入增加量，例如 1000"'))}<div class="quota-equation">当前总额度 ${number(c.quota_total)} 封<span class="cell-stack">保存后的总额度</span><strong data-quota-target>${number(c.quota_total)} 封</strong></div><div class="dialog-actions"><button type="button" class="button secondary" data-close>取消</button><button class="button primary" type="submit">保存额度</button></div></form>`);
    $('[name="increase"]', view.form).addEventListener('input', event => { try { $('[data-quota-target]', view.form).textContent = `${number(quotaTarget(c.quota_total, event.target.value))} 封`; } catch { $('[data-quota-target]', view.form).textContent = '请输入有效增加量'; } });
    bindSubmit(view.form, async values => { await ctx.api.setQuota(id, c.version, quotaTarget(c.quota_total, values.increase)); view.close(); showToast('永久额度已增加。'); await ctx.refresh(); });
  });
  onClick(ctx.root, '[data-enabled]', async (_, button) => {
    const approved = await confirmDialog(c.enabled ? '停用这位客户？' : '启用这位客户？', c.enabled ? '停用后，该客户的发送、核验和查询接口均不可调用。已经开始的发送仍会正常结算。' : `启用后客户可使用 ID 和密钥调用服务，当前可用额度为 ${number(c.available_count)} 封。`, c.enabled ? '确认停用' : '确认启用', c.enabled);
    if (!approved) return; button.disabled = true;
    try { await ctx.api.setEnabled(id, c.version, !c.enabled); showToast(c.enabled ? '客户已停用。' : '客户已启用。'); await ctx.refresh(); } finally { button.disabled = false; }
  });
  onClick(ctx.root, '[data-reset-key]', async (_, button) => {
    if (!await confirmDialog('重置客户调用密钥？', '旧密钥将立即失效。请在生成后保存新密钥，并同步更新客户后端配置。额度与历史记录保持不变。', '确认重置', true)) return;
    button.disabled = true;
    try { const updated = await ctx.api.resetKey(id, c.version); revealKey(updated, () => { void ctx.refresh(); }); }
    finally { button.disabled = false; }
  });
}
