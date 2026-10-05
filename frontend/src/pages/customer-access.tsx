import { useEffect, useState } from 'react';
import { useAdmin } from '../app/admin';
import { useUnsavedGuard } from '../app/guard';
import { explainError } from '../lib/format';
import { invalidate } from '../lib/query';
import { Button, CopyButton, Notice, PanelHead, Segmented, Tip, cx } from '../ui/controls';
import { useConfirm, useToast } from '../ui/overlay';
import { useCustomer } from './customer';

type Example = 'send' | 'verify' | 'status';

const EXAMPLES: Record<Example, { label: string; note: string; request: (base: string) => string }> = {
  send: {
    label: '发送验证码',
    note: 'request_id 由客户后端为每次发送生成一个 UUID；同一个编号重试不会重复发信，也不会重复扣额度。',
    request: base => `curl -X POST ${base}/send \\
  -H "$AUTH" -H "$CUSTOMER" -H "Content-Type: application/json" \\
  -d '{"request_id":"b9199534-97fb-4d68-ae66-b4c02c278f94","email":"user@example.com","client_ip":"203.0.113.10"}'`,
  },
  verify: {
    label: '核验验证码',
    note: '核验成功即核销，同一个验证码不能用第二次；连续输错 5 次后失效。',
    request: base => `curl -X POST ${base}/verify \\
  -H "$AUTH" -H "$CUSTOMER" -H "Content-Type: application/json" \\
  -d '{"email":"user@example.com","code":"083721"}'`,
  },
  status: {
    label: '查询发送状态',
    note: '发送请求超时没有拿到结果时，用原来的 request_id 查询，不要换新编号重发。',
    request: base => `curl ${base}/requests/b9199534-97fb-4d68-ae66-b4c02c278f94 \\
  -H "$AUTH" -H "$CUSTOMER"`,
  },
};

const envSnippet = (customerId: string, apiKey: string) =>
  `MAILQUOTA_BASE_URL=${location.origin}\nMAILQUOTA_CUSTOMER_ID=${customerId}\nMAILQUOTA_API_KEY=${apiKey}`;

/**
 * 把客户接进来需要的一切：地址、ID、密钥、可直接粘贴的配置和调用示例。
 * 刚创建或刚重置时，完整密钥就显示在「调用密钥」这一格里（平时这里是掩码），不另开一页。
 */
export function CustomerAccess() {
  const { customer } = useCustomer();
  const { api, secret, setSecret } = useAdmin();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [example, setExample] = useState<Example>('send');
  const id = customer.customer_id;
  const key = secret?.customer_id === id ? secret.api_key : null;

  // 每换一把新密钥，都要重新复制一次才算保存过。
  useEffect(() => setCopied(false), [key]);
  useUnsavedGuard(key !== null && !copied, { title: '还没有复制密钥', body: '离开之后无法再次查看这把密钥，只能重置生成新的。', confirmLabel: '仍然离开' });

  const resetKey = async () => {
    const agreed = await confirm({
      title: '重置调用密钥？',
      body: '旧密钥会立刻失效。在客户后端换上新密钥之前，他们的发送和核验都会失败。额度和历史记录不受影响。',
      confirmLabel: '重置密钥',
      danger: true,
    });
    if (!agreed) return;
    setBusy(true);
    try {
      setSecret(await api.resetKey(id, customer.version));
      toast('新密钥已生成，旧密钥已失效。');
    } catch (error) {
      toast(explainError(error), 'danger');
    } finally {
      // 无论成功、冲突还是结果不明，都读回最新的版本号和密钥掩码。
      invalidate(`customer:${id}`, 'customers');
      setBusy(false);
    }
  };

  const env = envSnippet(id, key ?? '<创建或重置时得到的密钥>');
  const shell = `AUTH="Authorization: Bearer $MAILQUOTA_API_KEY"\nCUSTOMER="X-Customer-Id: ${id}"\n\n${EXAMPLES[example].request(`${location.origin}/api/v1/verification-codes`)}`;
  const markCopied = () => setCopied(true);

  return (
    <div className="access">
      <section className="panel reveal">
        <PanelHead icon="key-round" title="接入凭据" tip="交给客户的后端开发者。密钥只能放在他们自己的后端服务里，不能下发给浏览器或 App。" />
        {key ? (
          <Notice tone="warn" icon="triangle-alert" title="完整密钥只显示这一次" action={<Button size="sm" onClick={() => setSecret(null)}>我已保存</Button>}>
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
              ? <dd><span className="mono">{key}</span><CopyButton value={key} label="复制密钥" onCopied={markCopied} /></dd>
              : <dd><span className="mono">{customer.api_key_mask}</span><Tip>完整密钥只在创建或重置时显示一次，之后这里只留掩码。丢了就在下面重置。</Tip></dd>}
          </div>
        </dl>
        <div className="code">
          <div className="code__bar">
            <span>.env</span>
            <CopyButton value={env} label="复制整份配置" variant={key ? 'primary' : 'ghost'} onCopied={key ? markCopied : undefined}>{key ? '复制整份配置' : '复制'}</CopyButton>
          </div>
          <pre className="code__body">{env}</pre>
        </div>
      </section>

      <section className="panel reveal">
        <PanelHead icon="terminal" title="调用示例" tip={EXAMPLES[example].note}>
          <Segmented label="示例接口" size="sm" value={example} onChange={setExample} options={(Object.keys(EXAMPLES) as Example[]).map(value => ({ value, label: EXAMPLES[value].label }))} />
        </PanelHead>
        <div className="code">
          <div className="code__bar"><span>shell</span><CopyButton value={shell} label="复制示例命令">复制</CopyButton></div>
          {/* 命令不折行、高度固定：换示例时这块的大小不变，下面的内容不会跟着动。 */}
          <pre className="code__body code__body--fixed">{shell}</pre>
        </div>
      </section>

      <section className="panel access__reset reveal">
        <div>
          <h2>重置密钥</h2>
          <p>密钥泄露或丢失时使用。旧密钥立刻失效，新密钥只显示一次；额度和记录不受影响。</p>
        </div>
        <Button variant="danger-soft" icon="refresh-cw" busy={busy} onClick={() => void resetKey()}>重置密钥</Button>
      </section>
    </div>
  );
}
