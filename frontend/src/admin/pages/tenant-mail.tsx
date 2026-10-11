import { MailEditor } from '../../shared/mail-editor';
import { useAdmin } from '../context';
import { useSaveTenant, useTenant } from './tenant';

/** 管理员替租户修改邮件内容，和租户在自己的门户里用的是同一个编辑器。 */
export function TenantMail() {
  const { tenant } = useTenant();
  const { session } = useAdmin();
  const save = useSaveTenant();
  return <MailEditor config={tenant} sender={session.sender} save={changes => save(tenant, changes)} />;
}
