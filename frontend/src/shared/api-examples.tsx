import { useState } from 'react';
import { CopyButton, PanelHead, Segmented, cx } from '../ui/controls';

type Example = 'send' | 'verify' | 'status';

const EXAMPLES: Record<Example, { label: string; note: string; request: (base: string) => string }> = {
  send: {
    label: '发送验证码',
    note: 'request_id 由业务后端为每次发送生成一个 UUID；同一个编号重试不会重复发信，也不会重复扣额度。还可以带上 reported_client_ip 记下用户的 IP，只用于审计。',
    request: base => `curl -X POST ${base}/send \\
  -H "$AUTH" -H "$CUSTOMER" -H "Content-Type: application/json" \\
  -d '{"request_id":"b9199534-97fb-4d68-ae66-b4c02c278f94","email":"user@example.com"}'`,
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

/** 业务后端需要的三项配置，写成可以直接粘贴的 .env。 */
export const envSnippet = (customerId: string, apiKey: string) =>
  `MAILQUOTA_BASE_URL=${location.origin}\nMAILQUOTA_CUSTOMER_ID=${customerId}\nMAILQUOTA_API_KEY=${apiKey}`;

/** 可以直接粘贴运行的调用示例。管理端的「接入」页和租户门户的「接入」页共用。 */
export function ApiExamples({ customerId, className }: { customerId: string; className?: string }) {
  const [example, setExample] = useState<Example>('send');
  const shell = `AUTH="Authorization: Bearer $MAILQUOTA_API_KEY"\nCUSTOMER="X-Customer-Id: ${customerId}"\n\n${EXAMPLES[example].request(`${location.origin}/api/v1/verification-codes`)}`;
  return (
    <section className={cx('panel reveal', className)}>
      <PanelHead icon="terminal" title="调用示例" tip={EXAMPLES[example].note}>
        <Segmented label="示例接口" size="sm" value={example} onChange={setExample} options={(Object.keys(EXAMPLES) as Example[]).map(value => ({ value, label: EXAMPLES[value].label }))} />
      </PanelHead>
      <div className="code">
        <div className="code__bar"><span>shell</span><CopyButton value={shell} label="复制示例命令">复制</CopyButton></div>
        {/* 命令不折行、高度固定：换示例时这块的大小不变，下面的内容不会跟着动。 */}
        <pre className="code__body code__body--fixed">{shell}</pre>
      </div>
    </section>
  );
}
