import { describeForecast, forecast, formatNumber, HEALTH_LABEL, quotaHealth } from '../lib/format';
import type { Quota } from '../types';
import { PanelHead, Tip } from '../ui/controls';
import { Icon } from '../ui/icon';
import { Odometer, QuotaMeter } from '../ui/meter';

/**
 * 可用额度面板：大读数、额度条、已用和总量，加一句按近 7 天速度的预估。
 * 管理端的租户概览和租户自己的概览用的是同一块；forTenant 时，额度不够的提示会请对方联系管理员。
 */
export function QuotaPanel({ quota, week, forTenant = false }: { quota: Quota; week: number; forTenant?: boolean }) {
  const outlook = forecast(week, quota.available_count);
  const health = quotaHealth(quota, outlook.remainingDays);
  const flag = HEALTH_LABEL[health];
  const ask = forTenant ? '，请联系管理员增加额度' : '';
  const verdict = health === 'unset' ? `还没有设置额度，发送会被拒绝${ask}` : health === 'empty' ? `额度已用完，新的验证码发不出去${ask}` : describeForecast(outlook);

  return (
    <section className="panel quota-panel reveal">
      <PanelHead icon="gauge" title="可用额度">{flag ? <em className={`tag tag--${health}`}>{flag}</em> : null}</PanelHead>
      <div className="readout readout--hero"><Odometer value={quota.available_count} /><span className="readout__unit">封</span></div>
      <QuotaMeter quota={quota} health={health} large />
      <dl className="split">
        <div><dt>已用</dt><dd>{formatNumber(quota.used_count)}</dd></div>
        {/* 占用通常是 0，只在真的有邮件占着额度时才出现。 */}
        {quota.reserved_count > 0 ? (
          <div>
            <dt>占用中<Tip>发送中或结果不明的邮件暂时占着的额度，有了结果就转为已用或退回。</Tip></dt>
            <dd>{formatNumber(quota.reserved_count)}</dd>
          </div>
        ) : null}
        <div><dt>总额度</dt><dd>{formatNumber(quota.quota_total)}</dd></div>
      </dl>
      <p className={`forecast forecast--${health}`}>
        {health === 'ok' ? null : <Icon name="triangle-alert" size={15} />}
        {verdict}
      </p>
    </section>
  );
}
