import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../icons';
import { previewDocument, validateTemplate } from '../helpers';
import type { Customer } from '../types';
import { useAdmin } from '../components/app';
import { EmptyState, Field, FormError, LoadingState, explainError, useConfirm, useToast } from '../components/ui';

export function TemplateTab({ customer, onRefresh }: { customer: Customer; onRefresh: () => void }) {
  const { api, setDirty } = useAdmin();
  const showToast = useToast();
  const confirm = useConfirm();
  const [template, setTemplate] = useState<{ html: string; version: number } | null>(null);
  const [html, setHtml] = useState('');
  const [text, setText] = useState(customer.text_template);
  const [initial, setInitial] = useState({ html: '', text: customer.text_template });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  const [previewStatus, setPreviewStatus] = useState('正在准备预览…');
  const [narrow, setNarrow] = useState(false);
  const previewSequence = useRef(0);
  const currentHtml = useRef('');
  const dirty = html !== initial.html || text !== initial.text || busy;

  useEffect(() => {
    setDirty(() => dirty);
    return () => setDirty(() => false);
  }, [dirty, setDirty]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    api.template(customer.customer_id).then(value => {
      if (!active) return;
      if (customer.version !== value.version) throw new Error('读取期间配置发生了变化，请重新加载以取得一致的版本。');
      setTemplate(value);
      setHtml(value.html);
      currentHtml.current = value.html;
      setText(customer.text_template);
      setInitial({ html: value.html, text: customer.text_template });
    }).catch(value => { if (active) setError(value); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, customer, refresh]);

  const updatePreview = async () => {
    const sequence = ++previewSequence.current;
    setPreviewStatus('正在更新预览…');
    try {
      validateTemplate(html);
      const rendered = await api.preview(html);
      if (sequence !== previewSequence.current) return;
      setPreview(previewDocument(rendered));
      setPreviewStatus(html === currentHtml.current ? '预览已更新（示例验证码，不发送邮件）' : '预览已更新（当前修改尚未保存）');
    } catch (value) {
      if (sequence === previewSequence.current) setPreviewStatus('预览未更新：' + explainError(value));
    }
  };
  useEffect(() => {
    if (!template || !html) return;
    const timer = window.setTimeout(() => void updatePreview(), 450);
    return () => window.clearTimeout(timer);
  }, [html, template]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => {
    if (dirty && !await confirm('放弃未保存的模板修改？', '重新读取会覆盖当前 HTML 和纯文本内容。', '重新读取', true)) return;
    setRefresh(value => value + 1);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!template || busy) return;
    setError(undefined);
    setBusy(true);
    let htmlSaved = false;
    try {
      validateTemplate(html);
      validateTemplate(text, 16 * 1024);
      const saved = await api.saveTemplate(customer.customer_id, template.version, html);
      htmlSaved = true;
      setTemplate({ html, version: saved.version });
      setInitial(current => ({ ...current, html }));
      await api.saveMail(customer.customer_id, saved.version, { from_name: customer.from_name, subject: customer.subject, reply_to: customer.reply_to, text_template: text });
      setInitial({ html, text });
      showToast('邮件模板已保存。');
      onRefresh();
    } catch (value) { setError(htmlSaved ? new Error('HTML 已保存，但纯文本未保存。请保留当前内容后重试纯文本保存。') : value); }
    finally { setBusy(false); }
  };

  if (loading) return <LoadingState />;
  if (error || !template) return <EmptyState message={explainError(error)} action={<button className="button secondary" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh-cw" />重新加载</button>} />;
  return <><div className="template-controls"><div className="template-help"><span><code>{'{{code}}'}</code> 验证码</span><span><code>{'{{expires_minutes}}'}</code> 有效分钟数</span><span>HTML 256 KiB · 纯文本 16 KiB</span></div><div className="template-actions"><p className={dirty ? 'save-status unsaved' : 'save-status'}>{dirty ? '有未保存的修改' : '已保存'}</p><button type="button" className="button secondary small" onClick={() => void reload()}><Icon name="refresh-cw" />重新加载</button><button type="submit" form="tpl-form" className="button primary small" disabled={busy}><Icon name="save" />{busy ? '正在保存…' : '保存模板'}</button></div></div><form id="tpl-form" onSubmit={save}><FormError error={error} /><div className="editor-grid"><section className="editor-pane"><div className="editor-toolbar"><h3>HTML 源码</h3></div><textarea className="code-editor" value={html} onChange={event => setHtml(event.target.value)} aria-label="HTML 邮件模板源码" spellCheck={false} autoCapitalize="off" autoComplete="off" required /></section><section className="editor-pane"><div className="editor-toolbar"><h3>邮件预览</h3><div className="button-group"><button type="button" className="button quiet small icon-button" onClick={() => setNarrow(value => !value)} aria-label={narrow ? '切换宽屏预览' : '切换窄屏预览'} title={narrow ? '切换宽屏预览' : '切换窄屏预览'} aria-pressed={narrow}><Icon name={narrow ? 'monitor' : 'smartphone'} /></button><button type="button" className="button secondary small" onClick={() => void updatePreview()} disabled={busy}><Icon name="refresh-cw" />更新预览</button></div></div><div className={'preview-host' + (narrow ? ' mobile' : '')}><iframe className="preview-frame" title="邮件模板隔离预览" sandbox="" referrerPolicy="no-referrer" srcDoc={preview} /></div></section></div><div className="preview-description" role="status">{previewStatus}</div><section className="panel plain-panel"><div className="panel-heading"><div className="panel-title"><h2>纯文本正文</h2></div></div><div className="panel-body"><div className="plain-grid"><Field label="纯文本正文"><textarea name="text_template" rows={5} value={text} onChange={event => setText(event.target.value)} required spellCheck={false} aria-label="纯文本正文" /></Field><div><h3>纯文本预览</h3><pre className="plain-preview">{text.replace(/{{code}}/g, '083721').replace(/{{expires_minutes}}/g, '5')}</pre></div></div></div></section></form></>;
}
