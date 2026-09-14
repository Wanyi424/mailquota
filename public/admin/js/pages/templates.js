import { escapeHtml as e, customerLink, templateLink, validateTemplate, previewDocument } from '../helpers.js';
import { $, header, empty, field, input, formError, bindSubmit, onClick, showToast, watchForm, explainError } from '../ui.js';

export async function templatesPage(ctx, id, tab = 'html') {
  const customers = await ctx.allCustomers(); if (!ctx.active()) return;
  if (!customers.length) { ctx.root.innerHTML = header('邮件模板', '为每位客户配置独立的发件信息与验证码邮件样式。') + `<section class="panel">${empty('先创建一位客户', '邮件模板按客户独立管理。创建客户后即可编辑和预览。', '<a class="button primary" href="#/customers">前往客户管理</a>')}</section>`; return; }
  if (!id) { await ctx.navigate(templateLink(customers[0].customer_id), { replace: true }); return; }
  const [customer, template] = await Promise.all([ctx.api.customer(id), ctx.api.template(id)]); if (!ctx.active()) return;
  if (customer.version !== template.version) throw new Error('读取期间配置发生了变化，请重新加载以取得一致的版本。');
  const c = customer;
  ctx.root.innerHTML = header('邮件模板', '从发件名称到邮件正文，让每位客户拥有自己的邮件样式。') +
    `<div class="selector-bar"><label for="template-customer">当前客户</label><select id="template-customer">${customers.map(item => `<option value="${e(item.customer_id)}" ${item.customer_id === id ? 'selected' : ''}>${e(item.name)} · ${e(item.customer_id)}</option>`).join('')}</select><a class="text-button" href="${customerLink(id)}">客户详情</a></div><nav class="tabs" aria-label="模板编辑栏目"><a href="${templateLink(id)}" class="${tab === 'mail' ? '' : 'active'}" ${tab === 'mail' ? '' : 'aria-current="page"'}>HTML 样式</a><a href="${templateLink(id)}?tab=mail" class="${tab === 'mail' ? 'active' : ''}" ${tab === 'mail' ? 'aria-current="page"' : ''}>发件信息与纯文本</a></nav><div id="template-workspace"></div>`;
  $('#template-customer', ctx.root).addEventListener('change', async event => {
    const selected = event.target.value;
    const moved = await ctx.navigate(`${templateLink(selected)}${tab === 'mail' ? '?tab=mail' : ''}`);
    if (!moved && event.target.isConnected) event.target.value = id;
  });
  const root = $('#template-workspace', ctx.root);
  if (tab === 'mail') renderMail(ctx, root, c);
  else renderHtml(ctx, root, c, template.html);
}

function renderMail(ctx, root, c) {
  root.innerHTML = `<section class="panel"><div class="panel-heading"><div><h2>发件信息</h2><p>以下设置独立保存，不会修改 HTML 模板。</p></div><button class="button secondary small" data-reload>重新加载</button></div><div class="panel-body"><form class="form-stack mail-form">${formError}<div class="form-grid">${field('发件昵称', input('from_name', c.from_name, 'required maxlength="100"'), '收件人看到的发件名称；实际发信地址由服务端统一配置。')}${field('回复邮箱', input('reply_to', c.reply_to, 'type="email" maxlength="254" placeholder="可选，留空使用默认设置"'))}<div class="span-full">${field('邮件标题', input('subject', c.subject, 'required maxlength="200"'), '标题为静态文本，不执行模板变量。')}</div></div>${field('纯文本正文', `<textarea name="text_template" rows="6" required spellcheck="false">${e(c.text_template)}</textarea>`, '用于不显示 HTML 的邮件客户端，必须包含 {{code}}，可使用 {{expires_minutes}}。')}<div><h3>纯文本预览</h3><p class="preview-description">固定示例验证码，不发送邮件。</p><pre class="plain-preview" id="text-preview"></pre></div><div class="form-footer"><p data-save-status>所有修改已保存 · 版本 ${c.version}</p><button type="submit" class="button primary">保存发件信息</button></div></form></div></section>`;
  const form = $('form', root), tracker = watchForm(form, dirty => { const label = $('[data-save-status]', form); label.textContent = dirty ? '有未保存的修改' : `所有修改已保存 · 版本 ${c.version}`; label.classList.toggle('unsaved', dirty); }); ctx.setDirty(tracker.dirty);
  const updateText = () => { $('#text-preview', root).textContent = $('[name="text_template"]', form).value.replace(/{{code}}/g, '083721').replace(/{{expires_minutes}}/g, '5'); };
  $('[name="text_template"]', form).addEventListener('input', updateText); updateText();
  onClick(root, '[data-reload]', () => ctx.refresh());
  bindSubmit(form, async values => {
    validateTemplate(values.text_template, 16 * 1024);
    if (/[\x00-\x1f\x7f]/.test(values.from_name) || /[\x00-\x1f\x7f]/.test(values.subject)) throw new Error('发件昵称和标题不能包含换行或控制字符。');
    await ctx.api.saveMail(c.customer_id, c.version, { ...values, from_name: values.from_name.trim(), subject: values.subject.trim(), reply_to: values.reply_to.trim() });
    tracker.reset(); showToast('发件信息与纯文本已保存。'); await ctx.refresh({ force: true });
  });
}

function renderHtml(ctx, root, c, html) {
  root.innerHTML = `<form><div class="notice"><div>预览使用示例验证码 <code>083721</code>，不会发送邮件或消耗额度。HTML 样式与发件信息分别保存。</div></div>${formError}<div class="editor-grid"><section class="editor-pane"><div class="editor-toolbar"><h3>HTML 源码</h3><button type="button" class="button quiet small" data-reload>重新加载</button></div><textarea class="code-editor" name="html" aria-label="HTML 邮件模板源码" spellcheck="false" autocapitalize="off" autocomplete="off" required>${e(html)}</textarea></section><section class="editor-pane"><div class="editor-toolbar"><h3>邮件预览</h3><div class="button-group"><button type="button" class="button quiet small" data-width aria-pressed="false">窄屏</button><button type="button" class="button secondary small" data-preview>更新预览</button></div></div><div class="preview-host"><iframe class="preview-frame" title="邮件模板隔离预览" sandbox="" referrerpolicy="no-referrer"></iframe></div></section></div><div class="template-help"><span>支持变量：<code>{{code}}</code> 验证码</span><span><code>{{expires_minutes}}</code> 有效分钟数</span><span>HTML 最大 256 KiB</span></div><div class="preview-description" data-preview-status role="status">正在准备预览…</div><div class="form-footer"><p data-save-status>所有修改已保存 · 版本 ${c.version}</p><button type="submit" class="button primary">保存 HTML 模板</button></div></form>`;
  const form = $('form', root), textarea = $('[name="html"]', form), previewStatus = $('[data-preview-status]', form);
  const tracker = watchForm(form, dirty => { const label = $('[data-save-status]', form); label.textContent = dirty ? '有未保存的修改' : `所有修改已保存 · 版本 ${c.version}`; label.classList.toggle('unsaved', dirty); previewStatus.textContent = '源码已修改，点击「更新预览」查看效果；更新预览不会保存。'; }); ctx.setDirty(tracker.dirty);
  let previewVersion = 0;
  async function updatePreview() {
    const seq = ++previewVersion, button = $('[data-preview]', form), source = textarea.value;
    button.disabled = true; previewStatus.textContent = '正在更新预览…';
    try {
      validateTemplate(source); const rendered = await ctx.api.preview(source);
      if (!ctx.active() || seq !== previewVersion) return;
      $('iframe', form).srcdoc = previewDocument(rendered);
      previewStatus.textContent = source === textarea.value ? '预览已更新 · 图片来自模板中配置的 HTTPS 地址' : '源码已继续修改，当前预览未包含最新输入。';
    } catch (error) { if (ctx.active() && seq === previewVersion) { previewStatus.textContent = `预览未更新：${explainError(error)}`; } }
    finally { if (seq === previewVersion) button.disabled = false; }
  }
  onClick(root, '[data-preview]', updatePreview);
  onClick(root, '[data-reload]', () => ctx.refresh());
  onClick(root, '[data-width]', (_, button) => { const narrow = $('.preview-host', root).classList.toggle('mobile'); button.setAttribute('aria-pressed', String(narrow)); button.textContent = narrow ? '宽屏' : '窄屏'; });
  bindSubmit(form, async values => { validateTemplate(values.html); await ctx.api.saveTemplate(c.customer_id, c.version, values.html); tracker.reset(); showToast('HTML 模板已保存。'); await ctx.refresh({ force: true }); });
  void updatePreview();
}
