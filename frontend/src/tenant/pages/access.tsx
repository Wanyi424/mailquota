import { formatDateTime } from '../../lib/format';
import { ApiExamples, envSnippet } from '../../shared/api-examples';
import { useTitle } from '../../shared/title';
import { CopyButton, ErrorState, PanelHead, Skeleton, Tip } from '../../ui/controls';
import { useMe } from '../context';

/** 业务后端接入需要的信息。只读：完整密钥由管理员保管，这里不显示也不能重置。 */
export function AccessPage() {
  const me = useMe();
  useTitle('接入');

  if (me.loading) {
    return (
      <div aria-busy="true" aria-label="正在读取">
        <div className="page-head"><Skeleton width={120} height={34} /></div>
        <Skeleton width="100%" height={320} />
      </div>
    );
  }
  if (!me.data) return <ErrorState error={me.error} onRetry={me.reload} />;

  const tenant = me.data;
  const env = envSnippet(tenant.customer_id, '<管理员提供的调用密钥>');

  return (
    <>
      <header className="page-head reveal"><h1>接入</h1></header>
      <div className="access">
        <section className="panel reveal">
          <PanelHead icon="key-round" title="调用凭据" tip="业务后端调用接口时需要这三项。密钥只能放在你们自己的后端服务里，不能下发给浏览器或 App。" />
          <dl className="kv">
            <div>
              <dt>服务地址</dt>
              <dd><span className="mono">{location.origin}</span><CopyButton value={location.origin} label="复制服务地址" /></dd>
            </div>
            <div>
              <dt>客户 ID</dt>
              <dd><span className="mono">{tenant.customer_id}</span><CopyButton value={tenant.customer_id} label="复制客户 ID" /></dd>
            </div>
            <div>
              <dt>调用密钥</dt>
              <dd>
                <span className="muted">{tenant.api_key_created_at ? `由管理员保管，生成于 ${formatDateTime(tenant.api_key_created_at)}` : '还没有可用的密钥，请联系管理员'}</span>
                <Tip>这里不显示完整密钥。丢失或泄露时请联系管理员重置，重置后旧密钥立刻失效。</Tip>
              </dd>
            </div>
          </dl>
          <div className="code">
            <div className="code__bar"><span>.env</span><CopyButton value={env} label="复制整份配置">复制</CopyButton></div>
            <pre className="code__body">{env}</pre>
          </div>
        </section>

        <ApiExamples customerId={tenant.customer_id} />
      </div>
    </>
  );
}
