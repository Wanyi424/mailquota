import { useEffect, useState } from 'react';
import { explainError, formatDateTime } from '../../lib/format';
import { isUnconfirmed } from '../../lib/http';
import { invalidate } from '../../lib/query';
import { generatePassword } from '../../lib/random';
import { ApiExamples, envSnippet } from '../../shared/api-examples';
import { useUnsavedGuard } from '../../shared/guard';
import { Button, CopyButton, Notice, PanelHead, Tip, cx } from '../../ui/controls';
import { useConfirm, useToast } from '../../ui/overlay';
import { useAdmin } from '../context';
import { useTenant } from './tenant';

const portalUrl = () => `${location.origin}/tenant/`;

/** 交给租户运营人员的登录信息，写成可以整段复制发过去的样子。 */
const accountSnippet = (loginName: string, password: string) =>
  `门户地址：${portalUrl()}\n登录账号：${loginName}\n登录密码：${password}`;

/**
 * 把租户接进来需要的一切，分成两份交给两种人：
 * 调用凭据给对方的后端开发，门户账号给对方的运营。
 * 刚创建或刚重置时，完整的密钥和密码就显示在各自那一格里，离开这一页就再也看不到。
 */
export function TenantAccess() {
  const { tenant } = useTenant();
  const { api, secret, setSecret } = useAdmin();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<'key' | 'password' | null>(null);
  const [copied, setCopied] = useState({ key: false, password: false });
  const id = tenant.customer_id;
  const mine = secret?.customer_id === id ? secret : null;
  const key = mine?.api_key ?? null;
  const password = mine?.password ?? null;

  // 每换一把新密钥或一个新密码，都要重新复制一次才算保存过。
  useEffect(() => setCopied(current => ({ ...current, key: false })), [key]);
  useEffect(() => setCopied(current => ({ ...current, password: false })), [password]);
  useUnsavedGuard((key !== null && !copied.key) || (password !== null && !copied.password), {
    title: '还有没复制的凭据',
    body: '离开之后无法再次查看，只能重置生成新的。',
    confirmLabel: '仍然离开',
  });

  // 确认已经保存：只把这一项从内存里清掉，另一项还在就继续留着。
  const forgetKey = () => setSecret(password ? { customer_id: id, password } : null);
  const forgetPassword = () => setSecret(key ? { customer_id: id, api_key: key } : null);

  const resetKey = async () => {
    const agreed = await confirm({
      title: '重置调用密钥？',
      body: '旧密钥会立刻失效。在租户的业务后端换上新密钥之前，他们的发送和核验都会失败。额度和历史记录不受影响。',
      confirmLabel: '重置密钥',
      danger: true,
    });
    if (!agreed) return;
    setBusy('key');
    try {
      const fresh = await api.resetKey(id);
      setSecret({ ...mine, customer_id: id, api_key: fresh.api_key });
      toast('新密钥已生成，旧密钥已失效。');
    } catch (error) {
      toast(isUnconfirmed(error) ? '连接中断，无法确认密钥是否已经重置。如果租户开始报认证失败，请再重置一次。' : explainError(error), 'danger');
    } finally {
      // 无论成功还是结果不明，都读回最新的密钥生成时间。
      invalidate(`tenant:${id}`);
      setBusy(null);
    }
  };

  const resetPassword = async () => {
    const agreed = await confirm({
      title: '重置登录密码？',
      body: `会为「${tenant.name}」生成一个新的随机密码，旧密码立刻失效。已经登录的设备不会被立即登出。`,
      confirmLabel: '重置密码',
      danger: true,
    });
    if (!agreed) return;
    const next = generatePassword();
    setBusy('password');
    try {
      await api.resetPassword(id, next);
      setSecret({ ...mine, customer_id: id, password: next });
      toast('新密码已生成，旧密码已失效。');
    } catch (error) {
      toast(isUnconfirmed(error) ? '连接中断，无法确认密码是否已经重置。请再重置一次。' : explainError(error), 'danger');
    } finally {
      setBusy(null);
    }
  };

  const env = envSnippet(id, key ?? '<创建或重置时得到的密钥>');
  const account = accountSnippet(tenant.login_name, password ?? '<创建或重置时得到的密码>');
  const keyCopied = () => setCopied(current => ({ ...current, key: true }));
  const passwordCopied = () => setCopied(current => ({ ...current, password: true }));

  return (
    <div className="access">
      <section className="panel reveal">
        <PanelHead icon="key-round" title="调用凭据" tip="交给租户的后端开发者。密钥只能放在他们自己的后端服务里，不能下发给浏览器或 App。">
          <Button size="sm" variant="danger-soft" icon="refresh-cw" busy={busy === 'key'} disabled={busy !== null} onClick={() => void resetKey()}>重置密钥</Button>
        </PanelHead>
        {key ? (
          <Notice tone="warn" icon="triangle-alert" title="完整密钥只显示这一次" action={<Button size="sm" onClick={forgetKey}>我已保存</Button>}>
            现在就复制保存。离开这一页后无法再次查看，只能重置生成新的。
          </Notice>
        ) : null}
        <dl className="kv">
          <div>
            <dt>服务地址</dt>
            <dd><span className="mono">{location.origin}</span><CopyButton value={location.origin} label="复制服务地址" /></dd>
          </div>
          <div>
            <dt>客户 ID</dt>
            <dd><span className="mono">{id}</span><CopyButton value={id} label="复制客户 ID" /></dd>
          </div>
          <div className={cx(key && 'is-fresh')}>
            <dt>调用密钥</dt>
            {key
              ? <dd><span className="mono">{key}</span><CopyButton value={key} label="复制密钥" onCopied={keyCopied} /></dd>
              : <dd><span className="muted">{tenant.api_key_created_at ? `生成于 ${formatDateTime(tenant.api_key_created_at)}` : '没有可用的密钥'}</span><Tip>完整密钥只在创建或重置时显示一次，系统里只保存它的哈希值。丢了就重置。</Tip></dd>}
          </div>
        </dl>
        <div className="code">
          <div className="code__bar">
            <span>.env</span>
            <CopyButton value={env} label="复制整份配置" variant={key ? 'primary' : 'ghost'} onCopied={key ? keyCopied : undefined}>{key ? '复制整份配置' : '复制'}</CopyButton>
          </div>
          <pre className="code__body">{env}</pre>
        </div>
      </section>

      <section className="panel reveal">
        <PanelHead icon="user-round" title="门户账号" tip="交给租户自己的运营或开发人员，用来登录租户门户查看额度、修改邮件内容、查发送记录。一个租户只有这一个账号。">
          <Button size="sm" variant="danger-soft" icon="refresh-cw" busy={busy === 'password'} disabled={busy !== null} onClick={() => void resetPassword()}>重置密码</Button>
        </PanelHead>
        {password ? (
          <Notice tone="warn" icon="triangle-alert" title="登录密码只显示这一次" action={<Button size="sm" onClick={forgetPassword}>我已保存</Button>}>
            现在就复制保存。离开这一页后无法再次查看，只能重置生成新的。
          </Notice>
        ) : null}
        <dl className="kv">
          <div>
            <dt>门户地址</dt>
            <dd><span className="mono">{portalUrl()}</span><CopyButton value={portalUrl()} label="复制门户地址" /></dd>
          </div>
          <div>
            <dt>登录账号</dt>
            <dd><span className="mono">{tenant.login_name}</span><CopyButton value={tenant.login_name} label="复制登录账号" /></dd>
          </div>
          <div className={cx(password && 'is-fresh')}>
            <dt>登录密码</dt>
            {password
              ? <dd><span className="mono">{password}</span><CopyButton value={password} label="复制密码" onCopied={passwordCopied} /></dd>
              : <dd><span className="muted">{tenant.last_login_at ? `最近登录于 ${formatDateTime(tenant.last_login_at)}` : '还没有登录过'}</span><Tip>密码只在创建或重置时显示一次，系统里只保存它的哈希值。租户忘记密码时在这里重置。</Tip></dd>}
          </div>
        </dl>
        <div className="code">
          <div className="code__bar">
            <span>登录信息</span>
            <CopyButton value={account} label="复制整份登录信息" variant={password ? 'primary' : 'ghost'} onCopied={password ? passwordCopied : undefined}>{password ? '复制整份登录信息' : '复制'}</CopyButton>
          </div>
          <pre className="code__body">{account}</pre>
        </div>
      </section>

      <ApiExamples customerId={id} className="access__wide" />
    </div>
  );
}
