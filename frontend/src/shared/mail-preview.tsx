import type { ReactNode } from 'react';
import { initialOf } from '../lib/format';
import { frameDocument } from '../lib/template';
import { cx } from '../ui/controls';

/** 仿收件箱的一封邮件：抬头照收件人看到的样子排，正文由调用方放进来。 */
export function MailFrame({ fromName, fromEmail, subject, to, mobile = false, children }: {
  fromName: string;
  /** 实际发信地址，知道的时候才显示。 */
  fromEmail?: string;
  subject: string;
  to: string;
  /** 收窄到手机宽度。 */
  mobile?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx('mail', mobile && 'mail--mobile')}>
      <div className="mail__head">
        <span className="avatar">{initialOf(fromName || '?')}</span>
        <div className="mail__meta">
          <p className="mail__from"><b>{fromName || '发件昵称'}</b>{fromEmail ? <span>&lt;{fromEmail}&gt;</span> : null}</p>
          <p className="mail__subject">{subject || '邮件标题'}</p>
          <p className="mail__to">发给 {to}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** HTML 正文放在完全隔离的 iframe 里：不能执行脚本，也碰不到外面的页面和会话。 */
export function HtmlBody({ html }: { html: string }) {
  return <iframe className="mail__body" title="HTML 正文隔离预览" sandbox="" referrerPolicy="no-referrer" srcDoc={frameDocument(html)} />;
}

export function TextBody({ text }: { text: string }) {
  return <pre className="mail__body mail__body--text">{text}</pre>;
}
