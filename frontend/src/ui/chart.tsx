import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { formatDay, formatNumber, STATUS, STATUSES, weekdayOf } from '../lib/format';
import type { Series } from '../types';
import { cx } from './controls';

export const CHART_HEIGHT = 220;
const TOP = 12;
const RIGHT = 12;
const AXIS = 28; // 底部留给日期的高度
const FLOOR = CHART_HEIGHT - AXIS; // 数值 0 所在的纵坐标

type Point = [x: number, y: number];

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 纵轴刻度取 1、2、5 的整数倍，三到五条线；全是 0 时只留一条基线。 */
function axisFor(peak: number) {
  if (peak <= 0) return { top: 1, ticks: [0] };
  const rough = peak / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 5].map(factor => factor * power).find(candidate => candidate >= rough) ?? 10 * power);
  const top = Math.ceil(peak / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * 把一串点连成平滑曲线（单调三次插值）：曲线经过每一个点，
 * 并且两点之间不会冲出它们的高度范围，所以不会画到 0 以下或凭空多出一个峰。
 * 最后一段单独返回，用来把「今天」画成虚线。
 */
function smooth(points: Point[]) {
  const last = points.length - 1;
  const slope = (i: number) => (points[i + 1][1] - points[i][1]) / (points[i + 1][0] - points[i][0]);
  const tangent = Array<number>(points.length).fill(0);
  for (let i = 1; i < last; i++) {
    const before = slope(i - 1);
    const after = slope(i);
    if (before * after > 0) tangent[i] = Math.sign(before) * 2 * Math.min(Math.abs(before), Math.abs(after), Math.abs(before + after) / 4);
  }
  tangent[0] = last > 1 ? (3 * slope(0) - tangent[1]) / 2 : slope(0);
  tangent[last] = last > 1 ? (3 * slope(last - 1) - tangent[last - 1]) / 2 : slope(last - 1);

  const curve = (i: number) => {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const third = (x1 - x0) / 3;
    return `C${round(x0 + third)},${round(y0 + third * tangent[i])} ${round(x1 - third)},${round(y1 - third * tangent[i + 1])} ${round(x1)},${round(y1)}`;
  };
  const start = (i: number) => `M${round(points[i][0])},${round(points[i][1])}`;
  let body = start(0);
  for (let i = 0; i < last - 1; i++) body += curve(i);
  return { body, tail: start(last - 1) + curve(last - 1), whole: body + curve(last - 1) };
}

/**
 * 每日发送量的面积折线图：实线是已发出，细红线是未发出（有才画）。
 * 悬停、点按或用左右方向键选中某一天时，在旁边浮出当天明细。
 */
export function TrendChart({ days, series }: { days: string[]; series: Series }) {
  const [ref, width] = useWidth();
  const gradient = useId();
  const count = days.length;
  const sent = series.accepted;
  const failed = series.failed;
  const hasFailed = failed.some(value => value > 0);
  const peak = Math.max(0, ...sent, ...failed);
  const { top, ticks } = axisFor(peak);
  const left = Math.max(...ticks.map(tick => formatNumber(tick).length)) * 7 + 16;
  const step = Math.max(0, width - left - RIGHT) / Math.max(1, count - 1);
  const x = (index: number) => left + index * step;
  const y = (value: number) => FLOOR - (value / top) * (FLOOR - TOP);

  // 横轴日期从今天往回等距取，按宽度决定取几个，保证不会挤在一起。
  const slots = Math.max(2, Math.min(7, Math.floor((width - left - RIGHT) / 72)));
  const every = Math.max(1, Math.ceil((count - 1) / (slots - 1)));
  const labels: number[] = [];
  for (let index = count - 1; index >= 0; index -= every) labels.push(index);

  const ready = step > 0 && count > 1;
  const sentLine = ready ? smooth(sent.map((value, index): Point => [x(index), y(value)])) : null;
  const failedLine = ready && hasFailed ? smooth(failed.map((value, index): Point => [x(index), y(value)])) : null;

  return (
    <div className="chart" ref={ref} style={{ height: CHART_HEIGHT }}>
      {sentLine ? (
        <>
          <svg className="chart__grid" width={width} height={CHART_HEIGHT} aria-hidden="true">
            {ticks.map(tick => (
              <g key={tick}>
                <line className={tick === 0 ? 'chart__base' : undefined} x1={left} x2={width - RIGHT} y1={y(tick)} y2={y(tick)} />
                <text x={left - 10} y={y(tick)} dy="0.34em" textAnchor="end">{formatNumber(tick)}</text>
              </g>
            ))}
            {labels.map(index => (
              <text key={days[index]} x={x(index)} y={CHART_HEIGHT - 7} textAnchor={index === count - 1 ? 'end' : index === 0 ? 'start' : 'middle'}>
                {index === count - 1 ? '今天' : formatDay(days[index])}
              </text>
            ))}
          </svg>

          {/* 换统计范围时整层重新挂载，曲线从左到右重画一遍。 */}
          <div className="chart__data" key={`${days[0]}/${count}`}>
            <svg width={width} height={CHART_HEIGHT} aria-hidden="true">
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop className="chart__fade-from" offset="0" />
                  <stop className="chart__fade-to" offset="1" />
                </linearGradient>
              </defs>
              <path d={`${sentLine.whole}L${round(x(count - 1))},${FLOOR}L${round(x(0))},${FLOOR}Z`} fill={`url(#${gradient})`} />
              {failedLine ? (
                <>
                  <path className="chart__line chart__line--failed" d={failedLine.body} />
                  <path className="chart__line chart__line--failed chart__line--today" d={failedLine.tail} />
                </>
              ) : null}
              <path className="chart__line" d={sentLine.body} />
              <path className="chart__line chart__line--today" d={sentLine.tail} />
              <circle className="chart__dot" cx={x(count - 1)} cy={y(sent[count - 1])} r="3.5" />
            </svg>
          </div>

          {peak === 0 ? <p className="chart__empty">这段时间没有发送</p> : null}
          <Hover days={days} series={series} width={width} left={left} step={step} y={y} showFailed={hasFailed} />
        </>
      ) : null}
    </div>
  );
}

type HoverProps = { days: string[]; series: Series; width: number; left: number; step: number; y: (value: number) => number; showFailed: boolean };

/** 悬停层单独成一个组件：鼠标移动只重画参考线和浮窗，不重算曲线。 */
function Hover({ days, series, width, left, step, y, showFailed }: HoverProps) {
  const [active, setActive] = useState<{ index: number; pointer: number | null } | null>(null);
  const last = days.length - 1;
  const clamp = (index: number) => Math.max(0, Math.min(last, index));

  const locate = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setActive({ index: clamp(Math.round((event.clientX - box.left - left) / step)), pointer: event.clientY - box.top });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') setActive(null);
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    // 第一次按方向键先落在今天，之后逐日移动。
    setActive({ index: active ? clamp(active.index + (event.key === 'ArrowLeft' ? -1 : 1)) : last, pointer: null });
  };

  const index = active ? clamp(active.index) : 0;
  const at = left + index * step;
  const rows = STATUSES.filter(status => status === 'accepted' || status === 'failed' || series[status][index] > 0);
  // 浮窗跟着光标的高度走，但整块留在图表范围内。
  const half = 30 + rows.length * 12;
  const height = Math.max(half, Math.min(CHART_HEIGHT - half, active?.pointer ?? y(series.accepted[index])));

  return (
    <div
      className="chart__hover"
      tabIndex={0}
      role="group"
      aria-label={`近 ${days.length} 天每日发送量。按左右方向键逐日查看。`}
      onPointerMove={locate}
      onPointerDown={locate}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={onKeyDown}
    >
      {active ? (
        <>
          <svg width={width} height={CHART_HEIGHT} aria-hidden="true">
            <line className="chart__guide" x1={at} x2={at} y1={TOP} y2={FLOOR} />
            {showFailed ? <circle className="chart__dot chart__dot--failed" cx={at} cy={y(series.failed[index])} r="4" /> : null}
            <circle className="chart__dot" cx={at} cy={y(series.accepted[index])} r="5" />
          </svg>
          <div className={cx('chart__tip', at > width * 0.6 && 'is-flipped')} style={{ left: at, top: height }} role="status">
            <strong>{index === last ? '今天' : `${formatDay(days[index])} ${weekdayOf(days[index])}`}{index === last ? <em>截至目前</em> : null}</strong>
            <dl>
              {rows.map(status => (
                <div key={status} className={`chart__row chart__row--${status}`}>
                  <dt><i aria-hidden="true" />{STATUS[status].label}</dt>
                  <dd>{formatNumber(series[status][index])}</dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      ) : null}
    </div>
  );
}
