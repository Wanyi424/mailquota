import { escapeHtml as e, number, statusLabels } from './helpers.js';
import { icon } from './icons.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const badge = status => `<span class="badge ${e(status)}"><span class="status-dot"></span>${e(statusLabels[status] || (status === 'enabled' ? '已启用' : '已停用'))}</span>`;
export const field = (label, control, help = '') => `<label class="field"><span class="field-label">${label}</span>${control}${help ? `<span class="field-help">${help}</span>` : ''}</label>`;
export const input = (name, value = '', attrs = '') => `<input name="${name}" value="${e(value)}" ${attrs}>`;
export const formError = '<div class="form-error" role="alert" hidden></div>';
export const empty = (message, action = '') => `<div class="empty-state"><p>${e(message)}</p>${action}</div>`;
export const loading = () => '<div class="loading-state" role="status"><span class="spinner"></span><p>正在读取数据…</p></div>';
export function pagination(page, total, pageSize = 20) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="pagination"><span>共 ${number(total)} 条${total ? ` · ${number((page - 1) * pageSize + 1)}–${number(Math.min(page * pageSize, total))}` : ''}</span><div><button class="button small secondary icon-button" aria-label="上一页" title="上一页" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${icon('chevron-left')}</button><span>${page} / ${pages}</span><button class="button small secondary icon-button" aria-label="下一页" title="下一页" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>${icon('chevron-right')}</button></div></div>`;
}
export function showToast(message, kind = 'success') {
  const node = document.createElement('div'); node.className = `toast ${kind}`; node.textContent = message;
  $('#toasts').append(node); setTimeout(() => node.remove(), 5500);
}
export function explainError(error) {
  if (error.code === 'EDIT_CONFLICT') return '配置已在其他页面更新。你的输入仍保留，请重新读取最新配置后确认修改，系统不会自动覆盖。';
  if (error.code === 'STATE_CONFLICT') return '这条记录已经被处理。请关闭窗口并刷新列表查看最新结果。';
  if (error.code === 'CSRF_INVALID') return '登录安全信息已变化，请刷新页面重新验证。未保存的内容请先自行保留。';
  if (error.code === 'ADMIN_AUTH_REQUIRED') return '登录已过期，请重新登录。';
  if (error.retryAfter) return `${error.message} 约 ${Math.max(1, Math.ceil(error.retryAfter / 60))} 分钟后可重试。`;
  return error.message || '操作未完成，请稍后重试。';
}
export function showError(form, error) {
  const area = $('.form-error', form); if (!area) { showToast(explainError(error), 'error'); return; }
  area.hidden = false; area.textContent = explainError(error); area.scrollIntoView({ block: 'nearest' });
}
export function clearError(form) { const area = $('.form-error', form); if (area) { area.hidden = true; area.textContent = ''; } }
export function bindSubmit(form, handler) {
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (form.dataset.busy === 'true' || !form.reportValidity()) return;
    clearError(form); const values = Object.fromEntries(new FormData(form));
    const controls = $$('button[type="submit"], input, select, textarea', form), disabled = controls.map(node => node.disabled);
    const submit = $('button[type="submit"]', form), label = submit?.innerHTML;
    form.dataset.busy = 'true'; controls.forEach(node => { node.disabled = true; });
    if (submit) submit.textContent = form.dataset.busyLabel || '正在保存…';
    try { await handler(values, form); }
    catch (error) { showError(form, error); }
    finally { form.dataset.busy = 'false'; controls.forEach((node, index) => { node.disabled = disabled[index]; }); if (submit) submit.innerHTML = label; }
  });
}
export function onClick(root, selector, handler) {
  $$(selector, root).forEach(node => node.addEventListener('click', async event => {
    if (node.disabled) return;
    try { await handler(event, node); } catch (error) { showToast(explainError(error), 'error'); }
  }));
}
export function formFingerprint(form) {
  return JSON.stringify([...form.elements].filter(node => node.name && !['button', 'submit', 'reset'].includes(node.type)).map(node => [node.name, ['checkbox', 'radio'].includes(node.type) ? node.checked : node.value]));
}
export function watchForm(form, onDirty = () => {}) {
  let initial = formFingerprint(form);
  const dirty = () => formFingerprint(form) !== initial;
  form.addEventListener('input', () => onDirty(dirty()));
  form.addEventListener('change', () => onDirty(dirty()));
  return { dirty: () => form.dataset.busy === 'true' || dirty(), reset() { initial = formFingerprint(form); onDirty(false); } };
}
export function modal(title, subtitle, body, { wide = false, secret = false } = {}) {
  const dialog = document.createElement('dialog'); dialog.className = `dialog ${wide ? 'wide' : ''}`;
  const titleId = `dialog-title-${crypto.randomUUID()}`; dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `<header class="dialog-heading"><div><h2 id="${titleId}">${e(title)}</h2>${subtitle ? `<p>${e(subtitle)}</p>` : ''}</div>${secret ? '' : `<button type="button" class="button quiet icon-button dialog-x" aria-label="关闭窗口" title="关闭窗口">${icon('x')}</button>`}</header><div class="dialog-body">${body}</div>`;
  document.body.append(dialog);
  const form = $('form', dialog), tracker = form ? watchForm(form) : null;
  const close = () => { dialog.close(); dialog.remove(); };
  const askClose = async () => {
    if (form?.dataset.busy === 'true' || secret) return;
    if (tracker?.dirty() && !await confirmDialog('放弃未保存的修改？', '关闭后，本次输入不会保存。', '放弃修改')) return;
    close();
  };
  $('.dialog-x', dialog)?.addEventListener('click', askClose);
  $$('[data-close]', dialog).forEach(node => node.addEventListener('click', askClose));
  dialog.addEventListener('cancel', event => { event.preventDefault(); void askClose(); });
  dialog.showModal(); return { dialog, form, close, tracker };
}
export function confirmDialog(title, description, label = '确认', danger = false) {
  return new Promise(resolve => {
    const view = modal(title, description, `<div class="dialog-actions"><button class="button secondary" data-confirm-no>取消</button><button class="button ${danger ? 'danger' : 'primary'}" data-confirm-yes>${e(label)}</button></div>`, { secret: true });
    const finish = value => { view.close(); resolve(value); };
    $('[data-confirm-no]', view.dialog).addEventListener('click', () => finish(false));
    $('[data-confirm-yes]', view.dialog).addEventListener('click', () => finish(true));
    view.dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    $('[data-confirm-no]', view.dialog).focus();
  });
}
export async function copyText(value, button) {
  try { await navigator.clipboard.writeText(value); const original = button.innerHTML; button.innerHTML = icon('check') + (button.classList.contains('icon-button') ? '' : '已复制'); showToast('已复制'); setTimeout(() => { button.innerHTML = original; }, 1800); }
  catch { showToast('无法访问剪贴板，请选中文本后手动复制。', 'error'); }
}
export function revealKey(customer, afterClose = () => {}) {
  const key = customer.api_key;
  const view = modal('保存客户调用密钥', '完整密钥仅在此显示一次。关闭前请妥善保存，并仅配置到客户后端。', `<dl class="detail-list"><div><dt>客户 ID</dt><dd class="mono">${e(customer.customer_id)}</dd></div><div><dt>服务地址</dt><dd class="mono">${e(location.origin)}</dd></div></dl><label class="field"><span class="field-label">API 密钥</span><textarea class="secret-value mono" rows="3" readonly spellcheck="false">${e(key)}</textarea></label><div class="dialog-actions"><button class="button secondary" data-copy-key>复制密钥</button><button class="button primary" data-key-done>我已保存，关闭</button></div>`, { secret: true });
  $('[data-copy-key]', view.dialog).addEventListener('click', event => { void copyText(key, event.currentTarget); });
  $('[data-key-done]', view.dialog).addEventListener('click', () => { view.close(); afterClose(); });
}
