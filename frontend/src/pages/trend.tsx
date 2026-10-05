import { useRef, useState, type CSSProperties } from 'react';
import { useAdmin } from '../app/admin';
import { formatNumber, mergeSeries } from '../lib/format';
import { useQuery } from '../lib/query';
import type { Stats } from '../types';
import { CHART_HEIGHT, TrendChart } from '../ui/chart';
import { ErrorState, PanelHead, Segmented, Skeleton, cx } from '../ui/controls';

const RANGES = [7, 30, 90] as const;
type Range = typeof RANGES[number];
const STORAGE_KEY = 'mailquota.trend-days';

function storedRange(): Range {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return RANGES.find(range => range === saved) ?? 30;
  } catch {
    return 30;
  }
}

/**
 * 趋势图背后的统计数据。选过的统计范围会被记住，首页和客户页共用；
 * 换范围时先留着上一份数据，新数据到了再替换，图表不会闪成空白。
 */
export function useTrend() {
  const { api } = useAdmin();
  const [days, setDays] = useState(storedRange);
  const query = useQuery(`stats:${days}`, () => api.stats(days));
  const kept = useRef<Stats | undefined>(undefined);
  if (query.data) kept.current = query.data;
  const stats = query.data ?? (query.error ? undefined : kept.current);

  const choose = (next: Range) => {
    setDays(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch { /* 存不了时只在这一次访问里有效 */ }
  };
  return { days, choose, stats, error: query.error, reload: query.reload, stale: Boolean(stats && stats.days.length !== days) };
}

const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

function average(sent: number, days: number) {
  const mean = sent / days;
  if (sent === 0) return '日均 0 封';
  if (mean < 1) return '日均不到 1 封';
  return `日均 ${mean >= 10 ? formatNumber(Math.round(mean)) : mean.toFixed(1).replace(/\.0$/, '')} 封`;
}

function share(ratio: number) {
  const percent = ratio * 100;
  return percent < 0.1 ? '不到 0.1%' : `${percent.toFixed(percent < 10 ? 1 : 0)}%`;
}

/** 发送趋势面板。不传 customerId 时是所有客户的合计。 */
export function TrendPanel({ trend, customerId, className, style }: { trend: ReturnType<typeof useTrend>; customerId?: string; className?: string; style?: CSSProperties }) {
  const { stats } = trend;
  return (
    <section className={cx('panel trend', trend.stale && 'is-refreshing', className)} style={style}>
      <PanelHead icon="chart-line" title="发送趋势" tip="按北京时间分日统计。今天的数字还在累计，所以最后一段画成虚线。">
        <Segmented label="统计范围" size="sm" value={trend.days} onChange={trend.choose} options={RANGES.map(range => ({ value: range, label: `近 ${range} 天` }))} />
      </PanelHead>
      {stats
        ? <TrendBody stats={stats} customerId={customerId} />
        : trend.error ? <ErrorState error={trend.error} onRetry={trend.reload} /> : <Skeleton width="100%" height={CHART_HEIGHT + 97} />}
    </section>
  );
}

function TrendBody({ stats, customerId }: { stats: Stats; customerId?: string }) {
  const length = stats.days.length;
  // 时间窗内没有发送的客户不在统计结果里，按全 0 处理。
  const own = customerId ? stats.customers[customerId] : undefined;
  const series = mergeSeries(customerId ? (own ? [own] : []) : Object.values(stats.customers), length);
  const sent = total(series.accepted);
  const failed = total(series.failed);

  // 两组数字同时是图例，都只统计当前选中的范围；某一天的明细在图上悬停查看。
  return (
    <div className="trend__body">
      <dl className="trend__figures">
        <div className="trend__figure">
          <dt><i aria-hidden="true" />已发出</dt>
          <dd><b>{formatNumber(sent)}</b>封</dd>
          <dd>{average(sent, length)}</dd>
        </div>
        <div className="trend__figure trend__figure--failed">
          <dt><i aria-hidden="true" />未发出</dt>
          <dd><b>{formatNumber(failed)}</b>封</dd>
          <dd>{failed ? `占 ${share(failed / (sent + failed))}` : sent ? '全部发出' : '—'}</dd>
        </div>
      </dl>
      <TrendChart days={stats.days} series={series} />
    </div>
  );
}
