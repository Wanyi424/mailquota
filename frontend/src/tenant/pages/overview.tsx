import { Link } from 'react-router-dom';
import { forecast, formatDateTime, formatLongDate, formatNumber, formatRelative, greeting, quotaHealth } from '../../lib/format';
import { useQuery } from '../../lib/query';
import { QuotaPanel } from '../../shared/quota-panel';
import { useTitle } from '../../shared/title';
import { TrendPanel, useTrend } from '../../shared/trend';
import { ErrorState, Notice, PanelHead, Skeleton, StatusBadge, cx } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import { useMe, usePortal } from '../context';
import { RecordLink, useRecordDrawer } from './records';

/** 登录后的第一眼：还能发多少、最近发得怎么样。 */
export function OverviewPage() {
  const { api } = usePortal();
  const me = useMe();
  const trend = useTrend('stats', api.stats);
  const recent = useQuery('requests:recent', () => api.requests({ page: 1, page_size: 6 }));
  const records = useRecordDrawer();
  useTitle('概览');

  // 预估要用到统计数据，等它到了再画，避免额度面板先是一个样子、随后又变一次。
  if (me.loading || (!trend.stats && !trend.error)) {
    return (
      <div aria-busy="true" aria-label="正在读取">
        <div className="home-head">
          <Skeleton width={220} height={14} />
          <Skeleton width="min(560px, 80%)" height={44} />
        </div>
        <div className="overview">
          <Skeleton width="100%" height={300} />
          <Skeleton width="100%" height={300} />
        </div>
      </div>
    );
  }
  if (!me.data) return <ErrorState error={me.error} onRetry={me.reload} />;

  const tenant = me.data;
  const week = trend.stats?.week ?? 0;
  const health = quotaHealth(tenant, forecast(week, tenant.available_count).remainingDays);
  const sentToday = trend.stats ? trend.stats.series.accepted.at(-1) ?? 0 : null;
  const calm = tenant.enabled && health === 'ok';

  return (
    <>
      <header className="home-head reveal">
        <p className="eyebrow">{greeting()}，{tenant.name}<span aria-hidden="true"> · </span>{formatLongDate()}</p>
        <h1 className="headline">
          <i className={cx('led led--lg', calm ? 'led--live' : 'led--warn')} aria-hidden="true" />
          {!tenant.enabled
            ? '服务目前已停用。'
            : health === 'unset'
              ? '还没有可用的额度。'
              : health === 'empty'
                ? '额度已经用完。'
                : sentToday === null
                  ? '一切正常。'
                  : sentToday > 0
                    ? <>今天已发出 <b>{formatNumber(sentToday)}</b> 封。</>
                    : '今天还没有发送。'}
        </h1>
      </header>

      <div className="overview">
        {tenant.enabled ? null : (
          <Notice tone="warn" icon="triangle-alert">服务已被停用，业务后端的发送、核验和查询都会被拒绝。额度和记录都还在，请联系管理员恢复。</Notice>
        )}

        <QuotaPanel quota={tenant} week={week} forTenant />

        <section className="panel reveal">
          <PanelHead icon="history" title="最近发送">
            <Link className="link" to="/records" viewTransition>全部记录<Icon name="arrow-right" size={14} /></Link>
          </PanelHead>
          {recent.loading ? <Skeleton width="100%" height={200} /> : !recent.data ? <ErrorState error={recent.error} onRetry={recent.reload} /> : recent.data.items.length === 0 ? (
            <p className="panel__empty">还没有发送过邮件。</p>
          ) : (
            <ul className="mini-records">
              {recent.data.items.map(row => (
                <li key={row.request_id}>
                  <RecordLink row={row} className={cx(row.request_id === records.recordId && 'is-open')}>
                    <StatusBadge status={row.status} />
                    <span className="mono">{row.email}</span>
                    <time dateTime={row.created_at} title={formatDateTime(row.created_at)}>{formatRelative(row.created_at)}</time>
                  </RecordLink>
                </li>
              ))}
            </ul>
          )}
        </section>

        <TrendPanel className="reveal" trend={trend} />
        {records.drawer}
      </div>
    </>
  );
}
