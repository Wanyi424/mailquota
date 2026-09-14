import { icon } from '../icons.js';
import { escapeHtml as e, number, dateTime, dateBoundary, statusLabels } from '../helpers.js';
import { $, badge, empty, pagination, input, field, formError, modal, bindSubmit, onClick, confirmDialog, showToast, copyText, showError } from '../ui.js';

export async function requestsPage(ctx, pendingOnly, query) {
  const customers = await ctx.allCustomers(); if (!ctx.active()) return;
  const customerNames = new Map(customers.map(c => [c.customer_id, c.name]));
  const values = Object.fromEntries(query);
  const filters = { page: Math.max(1, Number(values.page) || 1), page_size: 20, customer_id: values.customer_id || '', status: pendingOnly ? 'unknown' : values.status || '', email: values.email || '', from: dateBoundary(values.from), to: dateBoundary(values.to, true) };
  if (filters.from !== undefined && filters.to !== undefined && filters.from > filters.to) throw new Error('开始日期不能晚于结束日期。');
  const data = await ctx.api.requests(filters); if (!ctx.active()) return;
  ctx.root.innerHTML = (pendingOnly && data.total ? `<div class="notice warning">${icon('circle-help')}<span>${number(data.total)} 条待确认记录仍占用额度，请核查服务商结果后处理。</span></div>` : '') +
    `<section class="panel"><form class="filter-form" id="request-filters">${field('客户', `<select name="customer_id"><option value="">全部客户</option>${customers.map(c => `<option value="${e(c.customer_id)}" ${filters.customer_id === c.customer_id ? 'selected' : ''}>${e(c.name)}</option>`).join('')}${filters.customer_id && !customerNames.has(filters.customer_id) ? `<option value="${e(filters.customer_id)}" selected>${e(filters.customer_id)}</option>` : ''}</select>`)}${field('发送状态', pendingOnly ? '<select disabled aria-label="仅待确认状态"><option>待确认</option></select>' : `<select name="status"><option value="">全部状态</option>${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${filters.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}${field('收件邮箱', input('email', filters.email, 'type="email" maxlength="254" placeholder="精确匹配邮箱"'))}${field('开始日期', input('from', values.from || '', 'type="date" min="1970-01-01"'))}${field('结束日期', input('to', values.to || '', 'type="date" min="1970-01-01"'))}<div class="filter-actions"><button type="submit" class="button primary small">${icon('sliders-horizontal')}筛选</button><button type="button" class="button quiet small" data-reset>清空</button><button type="button" class="button secondary small icon-button" data-refresh aria-label="刷新记录" title="刷新记录">${icon('refresh-cw')}</button></div>${formError}</form><div id="records-table"></div></section><footer class="page-footnote"><span>北京时间（UTC+8）</span></footer>`;
  const filterForm = $('#request-filters', ctx.root);
  filterForm.addEventListener('submit', async event => {
    event.preventDefault(); if (!filterForm.reportValidity()) return;
    try {
      const v = Object.fromEntries(new FormData(filterForm));
      const from = dateBoundary(v.from), to = dateBoundary(v.to, true);
      if (from !== undefined && to !== undefined && from > to) throw new Error('开始日期不能晚于结束日期。');
      await ctx.navigate(recordRoute(pendingOnly, { ...v, page: 1 }));
    } catch (error) { showError(filterForm, error); }
  });
  onClick(ctx.root, '[data-refresh]', () => ctx.refresh());
  onClick(ctx.root, '[data-reset]', () => ctx.navigate(pendingOnly ? '#/pending' : '#/requests'));
  const table = $('#records-table', ctx.root);
  if (!data.items.length) {
    table.innerHTML = empty(pendingOnly ? '暂无待确认记录' : '暂无符合条件的发送记录') + pagination(data.page, data.total);
  } else {
    table.innerHTML = `<div class="table-wrap"><table><thead><tr><th>收件邮箱 / 请求编号</th><th>客户</th><th>状态</th><th>额度处理</th><th>发送时间</th><th>操作</th></tr></thead><tbody>${data.items.map(row => `<tr><td><span class="cell-stack">${e(row.email)}<small class="mono request-id" title="${e(row.request_id)}">${e(row.request_id)}</small></span></td><td><span class="cell-stack">${e(customerNames.get(row.customer_id) || row.customer_id)}<small class="mono">${e(row.customer_id)}</small></span></td><td>${badge(row.status)}</td><td class="muted">${row.status === 'accepted' ? '已计用量 1 封' : row.status === 'failed' ? '占用已释放' : '占用 1 封'}</td><td><span class="cell-stack">${e(dateTime(row.created_at))}<small>${row.resolved_at ? '已人工处理' : row.error_code ? e(row.error_code) : '—'}</small></span></td><td><div class="button-group"><button class="text-button" data-detail="${row.id}">详情</button>${row.status === 'unknown' ? `<button class="button small secondary" data-resolve="${row.id}">处理</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div>${pagination(data.page, data.total)}`;
  }
  onClick(table, '[data-page]', (_, node) => ctx.navigate(recordRoute(pendingOnly, { ...values, page: node.dataset.page })));
  onClick(table, '[data-detail]', (_, node) => detail(ctx, data.items.find(row => String(row.id) === node.dataset.detail), customerNames));
  onClick(table, '[data-resolve]', (_, node) => resolveRecord(ctx, data.items.find(row => String(row.id) === node.dataset.resolve), customerNames));
}

function recordRoute(pendingOnly, values) {
  const query = new URLSearchParams();
  for (const key of ['customer_id', 'status', 'email', 'from', 'to', 'page']) if (values[key] && !(pendingOnly && key === 'status')) query.set(key, values[key]);
  return `#/${pendingOnly ? 'pending' : 'requests'}${query.size ? `?${query}` : ''}`;
}

function detail(ctx, row, names) {
  const entries = [
    ['客户', `${names.get(row.customer_id) || row.customer_id}（${row.customer_id}）`], ['收件邮箱', row.email], ['请求编号', row.request_id], ['用户 IP', row.client_ip],
    ['发送时间', dateTime(row.created_at)], ['更新时间', dateTime(row.updated_at)], ['服务商消息 ID', row.provider_message_id || '—'], ['错误代码', row.error_code || '—'], ['诊断说明', row.error_detail || '—'],
    ['人工处理时间', dateTime(row.resolved_at)], ['处理管理员', row.resolved_by || '—'], ['处理依据', row.resolution_note || '—'],
  ];
  const view = modal('发送详情', '', `<div class="record-details"><div class="button-group">${badge(row.status)}<button class="button quiet small" data-copy>${icon('copy')}复制请求编号</button></div><dl class="detail-list">${entries.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join('')}</dl></div><div class="dialog-actions"><button class="button secondary" data-close>关闭</button>${row.status === 'unknown' ? '<button class="button primary" data-handle>处理这条记录</button>' : ''}</div>`, { wide: true });
  onClick(view.dialog, '[data-copy]', (_, button) => copyText(row.request_id, button));
  onClick(view.dialog, '[data-handle]', () => { view.close(); resolveRecord(ctx, row, names); });
}

function resolveRecord(ctx, row, names) {
  const view = modal('确认这次发送的结果', '请先核查服务商的受理记录。处理完成后不能在此撤销。', `<div class="record-summary"><div><span>客户</span><strong>${e(names.get(row.customer_id) || row.customer_id)}</strong></div><div><span>收件邮箱</span><strong>${e(row.email)}</strong></div><div><span>当前占用</span><strong>1 封</strong></div><div><span>发送时间（北京时间）</span><strong>${e(dateTime(row.created_at))}</strong></div></div><form class="form-stack">${formError}<div class="resolve-choices"><label class="resolve-choice"><input type="radio" name="status" value="accepted" required><span><strong>确认已受理</strong><small>占用减少 1 封，永久已用增加 1 封。</small></span></label><label class="resolve-choice"><input type="radio" name="status" value="failed" required><span><strong>确认释放占用</strong><small>占用减少 1 封，客户可用额度恢复 1 封。</small></span></label></div>${field('核查依据', '<textarea name="note" rows="4" maxlength="2000" required placeholder="例如：已在服务商控制台核对请求时间和收件邮箱，确认受理。"></textarea>', '必填，最多 2000 字。依据与管理员身份会保存在记录中。')}<div class="dialog-actions"><button type="button" class="button secondary" data-close>取消</button><button type="submit" class="button primary">继续确认</button></div></form>`, { wide: true });
  bindSubmit(view.form, async values => {
    const note = values.note.trim(); if (!note) throw new Error('请填写核查依据，不能只输入空格。');
    if (!await confirmDialog(values.status === 'accepted' ? '确认计入永久已用？' : '确认释放这次占用？', values.status === 'accepted' ? `客户「${names.get(row.customer_id) || row.customer_id}」的永久已用将增加 1 封。这不会重新发送邮件。` : '客户可用额度将恢复 1 封。这不会重新发送邮件，也不会恢复旧验证码。', '确认处理', true)) return;
    await ctx.api.resolve(row.id, values.status, note); view.close(); showToast(values.status === 'accepted' ? '已确认受理，计入永久已用。' : '占用已释放，额度已恢复。'); await ctx.refresh();
  });
}
