import { icon } from '../icons.js';
import { escapeHtml as e, validateTemplate, previewDocument } from '../helpers.js';
import { $, field, formError, bindSubmit, onClick, showToast, watchForm, explainError } from '../ui.js';

// 客户详情内的「邮件模板」栏目：HTML 与纯文本同页编辑，一个保存按钮。
// 纯文本用于不显示 HTML 的邮件客户端作为兜底；发件昵称、标题、回复邮箱在「概览」的客户信息中维护。
export async function templateTab(ctx, c) {
  const template = await ctx.api.template(c.customer_id); if (!ctx.active()) return;
  if (c.version !== template.version) throw new Error('读取期间配置发生了变化，请重新加载以取得一致的版本。');
  ctx.root.innerHTML = `<div class="template-controls"><div class="template-help"><span>支持变量：<code>{{code}}</code> 验证码</span><span><code>{{expires_minutes}}</code> 有效分钟数</span><span>HTML 最大 256 KiB · 纯文本最大 16 KiB</span></div><div class="template-actions"><p class="save-status" data-save-status>已保存</p><button type="button" class="button secondary small" data-reload>${icon('refresh-cw')}重新加载</button><button type="submit" form="tpl-form" class="button primary small">${icon('save')}保存模板</button></div></div><div id="template-workspace"></div>`;
  onClick(ctx.root, '[data-reload]', () => ctx.refresh());
  renderEditor(ctx, $('#template-workspace', ctx.root), c, template.html);
}

function renderEditor(ctx, root, c, html) {
  root.innerHTML = `<form id="tpl-form">${formError}<div class="editor-grid"><section class="editor-pane"><div class="editor-toolbar"><h3>HTML 源码</h3></div><textarea class="code-editor" name="html" aria-label="HTML 邮件模板源码" spellcheck="false" autocapitalize="off" autocomplete="off" required>${e(html)}</textarea></section><section class="editor-pane"><div class="editor-toolbar"><h3>邮件预览</h3><div class="button-group"><button type="button" class="button quiet small icon-button" data-width aria-label="切换窄屏预览" title="切换窄屏预览" aria-pressed="false">${icon('smartphone')}</button><button type="button" class="button secondary small" data-preview>${icon('refresh-cw')}更新预览</button></div></div><div class="preview-host"><iframe class="preview-frame" title="邮件模板隔离预览" sandbox="" referrerpolicy="no-referrer"></iframe></div></section></div><div class="preview-description" data-preview-status role="status">正在准备预览…</div><section class="panel plain-panel"><div class="panel-heading"><div class="panel-title"><h2>纯文本正文</h2></div><p>兜底版本：当收件人的邮件客户端不显示 HTML 时，会改为展示这段纯文本。必须包含 {{code}}，可使用 {{expires_minutes}}；随上方 HTML 一起保存。</p></div><div class="panel-body"><div class="plain-grid">${field('纯文本正文', `<textarea name="text_template" rows="5" required spellcheck="false" aria-label="纯文本正文">${e(c.text_template)}</textarea>`)}<div><h3>纯文本预览</h3><pre class="plain-preview" id="text-preview"></pre></div></div></div></section></form>`;
  const form = $('form', root), textarea = $('[name="html"]', form), textArea = $('[name="text_template"]', form);
  const previewStatus = $('[data-preview-status]', form), status = $('[data-save-status]', ctx.root);
  const tracker = watchForm(form, dirty => {
    status.textContent = dirty ? '有未保存的修改' : '已保存'; status.classList.toggle('unsaved', dirty);
    if (dirty) previewStatus.textContent = '源码已修改，点击「更新预览」查看效果；更新预览不会保存。';
  });
  ctx.setDirty(tracker.dirty);
  const updateText = () => { $('#text-preview', form).textContent = textArea.value.replace(/{{code}}/g, '083721').replace(/{{expires_minutes}}/g, '5'); };
  textArea.addEventListener('input', updateText); updateText();
  let previewVersion = 0;
  async function updatePreview() {
    const seq = ++previewVersion, button = $('[data-preview]', form), source = textarea.value;
    button.disabled = true; previewStatus.textContent = '正在更新预览…';
    try {
      validateTemplate(source); const rendered = await ctx.api.preview(source);
      if (!ctx.active() || seq !== previewVersion) return;
      $('iframe', form).srcdoc = previewDocument(rendered);
      previewStatus.textContent = source === textarea.value ? '预览已更新（示例验证码，不发送邮件）' : '源码已继续修改，当前预览未包含最新输入。';
    } catch (error) { if (ctx.active() && seq === previewVersion) { previewStatus.textContent = `预览未更新：${explainError(error)}`; } }
    finally { if (seq === previewVersion) button.disabled = false; }
  }
  onClick(root, '[data-preview]', updatePreview);
  onClick(root, '[data-width]', (_, button) => { const narrow = $('.preview-host', root).classList.toggle('mobile'); button.setAttribute('aria-pressed', String(narrow)); button.innerHTML = icon(narrow ? 'monitor' : 'smartphone'); button.title = narrow ? '切换宽屏预览' : '切换窄屏预览'; button.setAttribute('aria-label', button.title); });
  bindSubmit(form, async values => {
    validateTemplate(values.html);
    validateTemplate(values.text_template, 16 * 1024);
    // 顺序保存：HTML 先行并取回新版本号，纯文本复用当前发件信息随同一按钮提交。
    const saved = await ctx.api.saveTemplate(c.customer_id, c.version, values.html);
    await ctx.api.saveMail(c.customer_id, saved.version, { from_name: saved.from_name, subject: saved.subject, reply_to: saved.reply_to, text_template: values.text_template });
    tracker.reset(); showToast('邮件模板已保存。'); await ctx.refresh({ force: true });
  });
  void updatePreview();
}
