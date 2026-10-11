import { useEffect, useRef, useState, type FormEvent } from 'react';
import { explainError } from '../lib/format';
import { byteLength, HTML_LIMIT, renderTemplate, SAMPLE_CODE, SAMPLE_MINUTES, TEMPLATE_VARIABLES, TEXT_LIMIT, validateTemplate } from '../lib/template';
import type { MailChanges, MailConfig } from '../types';
import { Button, Field, Notice, PanelHead, Segmented, cx } from '../ui/controls';
import { useConfirm, useToast } from '../ui/overlay';
import { useUnsavedGuard } from './guard';
import { HtmlBody, MailFrame, TextBody } from './mail-preview';

const FIELDS = ['from_name', 'subject', 'reply_to', 'html_template', 'text_template'] as const;
type FieldName = typeof FIELDS[number];
type Draft = Record<FieldName, string>;

const pick = (config: MailConfig): Draft => ({ from_name: config.from_name, subject: config.subject, reply_to: config.reply_to ?? '', html_template: config.html_template, text_template: config.text_template });

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** 与后端一致的校验，输入时就指出哪里不对，而不是等保存被拒。 */
function findProblems(draft: Draft) {
  const problems: Partial<Record<FieldName, string>> = {};
  const header = (key: 'from_name' | 'subject', label: string, max: number) => {
    const value = draft[key].trim();
    if (!value) problems[key] = `${label}不能为空。`;
    else if (value.length > max) problems[key] = `${label}最多 ${max} 个字符。`;
    else if (CONTROL_CHARS.test(value)) problems[key] = `${label}不能包含换行或控制字符。`;
  };
  header('from_name', '发件昵称', 100);
  header('subject', '邮件标题', 200);
  if (draft.reply_to.trim() && !EMAIL.test(draft.reply_to.trim())) problems.reply_to = '请填写一个有效的邮箱地址，或者留空。';
  for (const [key, limit] of [['html_template', HTML_LIMIT], ['text_template', TEXT_LIMIT]] as const) {
    try {
      validateTemplate(draft[key], limit);
    } catch (error) {
      problems[key] = (error as Error).message;
    }
  }
  return problems;
}

function useDebounced<T>(value: T, delay: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * 一封邮件的全部内容在这里编辑：发件信息、HTML 正文、纯文本正文，一次保存。
 * 管理端替租户改、租户自己改，用的是同一个编辑器，区别只在保存到哪个接口。
 */
export function MailEditor({ config, sender, save }: {
  /** 最新保存的配置。它在别处被改动后会变，没有本地修改时编辑器跟着更新。 */
  config: MailConfig;
  /** 实际发信地址，只用于让预览更接近真实收件效果。 */
  sender: string;
  /** 提交改动过的项，返回保存后的配置。版本冲突时由调用方读回最新配置，再把错误原样抛回来。 */
  save: (changes: MailChanges) => Promise<MailConfig>;
}) {
  const confirm = useConfirm();
  const toast = useToast();

  // base 是开始编辑时的配置：只提交相对它改动过的项，别处改的其它项不会被顺手覆盖。
  const [base, setBase] = useState(() => pick(config));
  const [draft, setDraft] = useState(base);
  const [editor, setEditor] = useState<'html_template' | 'text_template'>('html_template');
  const [view, setView] = useState<'html' | 'text'>('html');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const area = useRef<HTMLTextAreaElement>(null);

  const changed = FIELDS.filter(key => draft[key] !== base[key]);
  const dirty = changed.length > 0;
  const problems = findProblems(draft);
  const blocked = FIELDS.some(key => problems[key]);
  useUnsavedGuard(dirty);

  // 没有本地修改时，跟随别处保存进来的最新配置。
  useEffect(() => {
    if (dirty) return;
    const latest = pick(config);
    setBase(latest);
    setDraft(latest);
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: FieldName, value: string) => {
    setDraft(current => ({ ...current, [key]: value }));
    setError(undefined);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !dirty || blocked) return;
    setBusy(true);
    setError(undefined);
    try {
      const trimmed: Draft = { ...draft, from_name: draft.from_name.trim(), subject: draft.subject.trim(), reply_to: draft.reply_to.trim() };
      const changes: MailChanges = {};
      for (const key of changed) changes[key] = trimmed[key];
      const saved = pick(await save(changes));
      setBase(saved);
      setDraft(saved);
      toast('邮件内容已保存，之后发出的验证码邮件都用新的内容。');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!await confirm({ title: '放弃这些修改？', body: '编辑器里的内容会恢复成上次保存的样子。', confirmLabel: '放弃修改', danger: true })) return;
    const latest = pick(config);
    setBase(latest);
    setDraft(latest);
    setError(undefined);
  };

  // Ctrl/⌘+S 保存。
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void submitRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const insert = (token: string) => {
    const element = area.current;
    if (!element) return;
    const start = element.selectionStart;
    set(editor, element.value.slice(0, start) + token + element.value.slice(element.selectionEnd));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const limit = editor === 'html_template' ? HTML_LIMIT : TEXT_LIMIT;
  const previewHtml = useDebounced(draft.html_template, 250);
  const conflict = (error as { code?: string } | undefined)?.code === 'EDIT_CONFLICT';

  return (
    <form className="email" onSubmit={submit}>
      <div className="email__editor">
        {/* 三项就是一封邮件的抬头，照写邮件时的样子排：一行一项，标签在左。 */}
        <section className="panel">
          <PanelHead icon="at-sign" title="发件信息" tip="收件人在收件箱列表里看到的内容。实际发信地址由服务端统一配置，这里改不了。" />
          <div className="form">
            <Field row label="发件昵称" error={problems.from_name} tip="显示为发件人的名字。">
              <input className="input" value={draft.from_name} onChange={event => set('from_name', event.target.value)} maxLength={100} />
            </Field>
            <Field row label="邮件标题" error={problems.subject} tip="固定文字，不支持变量。">
              <input className="input" value={draft.subject} onChange={event => set('subject', event.target.value)} maxLength={200} />
            </Field>
            <Field row label="回复邮箱" error={problems.reply_to} tip="收件人点「回复」时写给谁。留空则回复到发信地址。">
              <input className="input" type="email" value={draft.reply_to} onChange={event => set('reply_to', event.target.value)} maxLength={254} placeholder="选填，例如 support@example.com" />
            </Field>
          </div>
        </section>

        <section className="panel">
          <PanelHead icon="square-pen" title="正文" tip="每封邮件同时带 HTML 和纯文本两个版本：大多数邮箱显示 HTML，不支持的显示纯文本。两个版本都必须包含 {{code}}，并且只认下面这两个变量。">
            <Segmented
              label="正在编辑的正文"
              size="sm"
              value={editor}
              onChange={next => { setEditor(next); setView(next === 'html_template' ? 'html' : 'text'); }}
              options={[{ value: 'html_template', label: 'HTML', icon: 'code-xml' }, { value: 'text_template', label: '纯文本', icon: 'text' }]}
            />
          </PanelHead>
          <div className="email__vars">
            <span>插入变量</span>
            {TEMPLATE_VARIABLES.map(variable => (
              <button type="button" key={variable.token} className="chip chip--code" onClick={() => insert(variable.token)} title={`在光标处插入${variable.label}`}>
                <code>{variable.token}</code>{variable.label}
              </button>
            ))}
          </div>
          <textarea
            ref={area}
            key={editor}
            className={cx('editor', problems[editor] && 'is-invalid')}
            value={draft[editor]}
            onChange={event => set(editor, event.target.value)}
            aria-label={editor === 'html_template' ? 'HTML 正文源码' : '纯文本正文'}
            aria-invalid={Boolean(problems[editor])}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            wrap={editor === 'html_template' ? 'off' : 'soft'}
          />
          {/* 这一行始终占着位置，校验结果出现或消失都不会改变编辑区的高度。 */}
          <div className="email__status">
            <span className="email__problem" role="alert">{problems[editor]}</span>
            <span className="muted mono">{(byteLength(draft[editor]) / 1024).toFixed(1)} / {limit / 1024} KiB</span>
          </div>
        </section>
      </div>

      <aside className="email__preview">
        <div className="panel">
          <PanelHead icon="eye" title="预览" tip={`用示例验证码 ${SAMPLE_CODE}、有效 ${SAMPLE_MINUTES} 分钟渲染。预览不会发出邮件，也不消耗额度。`}>
            <Segmented label="预览版本" size="sm" value={view} onChange={setView} options={[{ value: 'html', label: 'HTML' }, { value: 'text', label: '纯文本' }]} />
            <Segmented
              label="预览宽度"
              size="sm"
              value={device}
              onChange={setDevice}
              options={[{ value: 'desktop', label: '', icon: 'monitor', title: '桌面宽度' }, { value: 'mobile', label: '', icon: 'smartphone', title: '手机宽度' }]}
            />
          </PanelHead>
          <MailFrame fromName={draft.from_name} fromEmail={sender} subject={draft.subject} to="user@example.com" mobile={device === 'mobile'}>
            {view === 'html' ? <HtmlBody html={renderTemplate(previewHtml)} /> : <TextBody text={renderTemplate(draft.text_template)} />}
          </MailFrame>
        </div>
      </aside>

      {dirty || error ? (
        <div className="savebar" role="region" aria-label="保存修改">
          {error ? (
            <Notice tone="danger" icon="circle-alert">
              {conflict ? '这份邮件配置刚刚在别处被改过，页面已经拿到最新版本。再点一次保存，会用你现在的内容覆盖对应的项；也可以放弃修改。' : explainError(error)}
            </Notice>
          ) : null}
          <div className="savebar__row">
            <span className="savebar__state"><i className="led led--warn" aria-hidden="true" />{changed.length} 项修改尚未保存</span>
            <Button variant="ghost" onClick={() => void discard()} disabled={busy}>放弃</Button>
            <Button type="submit" variant="primary" icon="check" busy={busy} disabled={blocked || !dirty} title={blocked ? '先修正标红的内容' : undefined}>保存</Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
