import { explainError } from '../../lib/format';
import { invalidate, setQueryData } from '../../lib/query';
import { MailEditor } from '../../shared/mail-editor';
import { useTitle } from '../../shared/title';
import type { MailChanges } from '../../types';
import { Button, ErrorState, Notice, Skeleton } from '../../ui/controls';
import { useMe, usePortal } from '../context';

/** 租户自己决定验证码邮件长什么样：发件昵称、标题、回复地址和两个版本的正文。 */
export function MailPage() {
  const { api, session } = usePortal();
  const me = useMe();
  useTitle('邮件');

  if (me.loading) {
    return (
      <div aria-busy="true" aria-label="正在读取">
        <div className="page-head"><Skeleton width={120} height={34} /></div>
        <Skeleton width="100%" height={420} />
      </div>
    );
  }
  if (!me.data) return <ErrorState error={me.error} onRetry={me.reload} />;

  const tenant = me.data;
  // 版本冲突时读回最新配置，再把错误交给编辑器去提示。
  const save = async (changes: MailChanges) => {
    try {
      const saved = await api.saveMail(tenant.version, changes);
      setQueryData('me', saved);
      return saved;
    } catch (error) {
      if ((error as { code?: string }).code === 'EDIT_CONFLICT') invalidate('me');
      throw error;
    }
  };

  return (
    <>
      <header className="page-head reveal"><h1>邮件</h1></header>
      {me.error ? (
        <Notice tone="warn" icon="triangle-alert" action={<Button size="sm" onClick={me.reload}>重试</Button>}>
          没能读到最新数据，下面显示的是上一次的结果。{explainError(me.error)}
        </Notice>
      ) : null}
      <MailEditor config={tenant} sender={session.sender} save={save} />
    </>
  );
}
