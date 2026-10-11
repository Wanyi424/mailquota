import { useRef, useState, type CSSProperties } from 'react';
import { formatNumber } from '../lib/format';
import { useQuery } from '../lib/query';
import type { DailyStats } from '../types';
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

export type Trend<T extends DailyStats = DailyStats> = {
  days: Range;
  choose: (next: Range) => void;
  stats: T | undefined;
  error: unknown;
  reload: () => void;
  /** 正在换统计范围，眼前还是上一个范围的数据。 */
  stale: boolean;
};

/**
 * 趋势图背后的统计数据。key 说明统计的是谁（全部租户，或某一个），load 按天数读取。
 * 选过的统计范围会被记住；换范围时先留着上一份数据，新数据到了再替换，图表不会闪成空白。
 */
export function useTrend<T extends DailyStats>(key: string, load: (days: number) => Promise<T>): Trend<T> {
  const [days, setDays] = useState(storedRange);
  const query = useQuery(`${key}:${days}`, () => load(days));
  // 留着的旧数据只在统计对象没变时才拿来垫场。
  const kept = useRef<{ key: string; data: T } | null>(null);
  if (query.data) kept.current = { key, data: query.data };
  const stats = query.data ?? (!query.error && kept.current?.key === key ? kept.current.data : undefined);

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

/** 发送趋势面板，画的是 trend 里那份统计。 */
export function TrendPanel({ trend, className, style }: { trend: Trend; className?: string; style?: CSSProperties }) {
  const { stats } = trend;
  return (
    <section className={cx('panel trend', trend.stale && 'is-refreshing', className)} style={style}>
      <PanelHead icon="chart-line" title="发送趋势" tip="按北京时间分日统计。今天的数字还在累计，所以最后一段画成虚线。">
        <Segmented label="统计范围" size="sm" value={trend.days} onChange={trend.choose} options={RANGES.map(range => ({ value: range, label: `近 ${range} 天` }))} />
      </PanelHead>
      {stats
        ? <TrendBody stats={stats} />
        : trend.error ? <ErrorState error={trend.error} onRetry={trend.reload} /> : <Skeleton width="100%" height={CHART_HEIGHT + 97} />}
    </section>
  );
}

function TrendBody({ stats }: { stats: DailyStats }) {
  const { days, series } = stats;
  const sent = total(series.accepted);
  const failed = total(series.failed);

  // 两组数字同时是图例，都只统计当前选中的范围；某一天的明细在图上悬停查看。
  return (
    <div className="trend__body">
      <dl className="trend__figures">
        <div className="trend__figure">
          <dt><i aria-hidden="true" />已发出</dt>
          <dd><b>{formatNumber(sent)}</b>封</dd>
          <dd>{average(sent, days.length)}</dd>
        </div>
        <div className="trend__figure trend__figure--failed">
          <dt><i aria-hidden="true" />未发出</dt>
          <dd><b>{formatNumber(failed)}</b>封</dd>
          <dd>{failed ? `占 ${share(failed / (sent + failed))}` : sent ? '全部发出' : '—'}</dd>
        </div>
      </dl>
      <TrendChart days={days} series={series} />
    </div>
  );
}
