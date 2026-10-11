import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { forecast, formatDaysLeft, formatLongDate, formatNumber, greeting, HEALTH_LABEL, quotaHealth, runway } from '../../lib/format';
import { useQuery } from '../../lib/query';
import { Pager } from '../../shared/records';
import { useTitle } from '../../shared/title';
import { TrendPanel, useTrend } from '../../shared/trend';
import type { TenantSummary } from '../../types';
import { Avatar, Button, ButtonLink, EmptyState, ErrorState, PanelHead, Skeleton, Tip, cx } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import { QuotaMeter } from '../../ui/meter';
import { tenantPath, useAdmin } from '../context';
import type { Stats } from '../types';

type Attention = { key: string; tone: 'danger' | 'warn' | 'info'; label: string; text: ReactNode; action: ReactNode };

const SEVERITY = { danger: 0, warn: 1, info: 2 };

// 租户可能有几百个：待办先摆最要紧的几件，列表分页显示。
const ATTENTION_LIMIT = 5;
const ROWS_PER_PAGE = 50;

/**
 * 首页只挑真正需要人动手的事：额度见底、结果不明的发送、建好却没启用的租户。
 * 这里是首页上唯一带操作按钮的地方，下面的租户列表只负责看和进入。
 */
function findAttention(tenants: TenantSummary[], stats: Stats | undefined, addQuota: (tenant: TenantSummary) => void) {
  const items: Attention[] = [];
  for (const tenant of tenants) {
    const id = tenant.customer_id;
    const name = <b>{tenant.name}</b>;
    const add = <Button size="sm" variant="primary" icon="plus" onClick={() => addQuota(tenant)}>加额度</Button>;
    if (!tenant.enabled) {
      // 用过之后再停用的，是有意为之，不算待办。
      if (tenant.used_count === 0) {
        items.push({ key: `off:${id}`, tone: 'info', label: '尚未启用', text: <>{name} 还没有启用，它的业务后端暂时无法调用。</>, action: <ButtonLink size="sm" to={tenantPath(id)} trailingIcon="arrow-right">去启用</ButtonLink> });
      }
      continue;
    }
    const outlook = forecast(stats?.week[id] ?? 0, tenant.available_count);
    const health = quotaHealth(tenant, outlook.remainingDays);
    if (health === 'unset') {
      items.push({ key: `unset:${id}`, tone: 'warn', label: '没有额度', text: <>{name} 已经启用，但总额度还是 0，发送会被拒绝。</>, action: add });
    } else if (health === 'empty') {
      items.push({ key: `empty:${id}`, tone: 'danger', label: '额度用完', text: <>{name} 的额度已经用完，新的验证码发不出去。</>, action: add });
    } else if (health === 'low') {
      const pace = outlook.remainingDays !== null && outlook.remainingDays < 365 ? `，按近 7 天的速度${formatDaysLeft(outlook.remainingDays)}用完` : '';
      items.push({ key: `low:${id}`, tone: 'warn', label: '额度告急', text: <>{name} 还剩 {formatNumber(tenant.available_count)} 封{pace}。</>, action: add });
    }
  }
  if (stats?.unresolved) {
    items.push({
      key: 'unknown',
      tone: 'warn',
      label: '结果不明',
      text: <>{formatNumber(stats.unresolved)} 封邮件没有等到服务商的明确答复，各占着 1 封额度，核查之后才能结算。</>,
      action: <ButtonLink size="sm" to="/records?status=unknown" trailingIcon="arrow-right">去核查</ButtonLink>,
    });
  }
  return items.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]);
}

const reveal = (order: number) => ({ '--order': order }) as CSSProperties;

export function HomePage() {
  const { api, session, adjustQuota, newTenant } = useAdmin();
  const tenants = useQuery('tenants', api.tenants);
  const trend = useTrend('stats/all', api.stats);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(false);
  useTitle('总览');

  // 等统计也到了再画首屏：待办和预估都要用它，分两次出现会把下面的内容顶下去。
  if (tenants.loading || (!trend.stats && !trend.error)) return <HomeSkeleton />;
  if (!tenants.data) return <ErrorState error={tenants.error} onRetry={tenants.reload} />;

  const list = tenants.data;
  const stats = trend.stats;

  if (list.length === 0) {
    return (
      <div className="hero-empty reveal">
        <p className="eyebrow">{greeting()}，{session.username}</p>
        <h1 className="headline">还没有租户。</h1>
        <p className="lead">创建第一个租户，把它的客户 ID 和调用密钥交给对方的后端，把门户账号交给对方的运营，就可以开始发验证码了。</p>
        <Button variant="primary" size="lg" icon="plus" onClick={newTenant}>新建租户</Button>
      </div>
    );
  }

  const attention = findAttention(list, stats, adjustQuota);
  const urgent = attention.filter(item => item.tone !== 'info').length;
  const sentToday = stats ? stats.series.accepted.at(-1) ?? 0 : null;
  const keyword = filter.trim().toLowerCase();
  const matched = keyword ? list.filter(tenant => `${tenant.name} ${tenant.customer_id} ${tenant.login_name}`.toLowerCase().includes(keyword)) : list;
  const current = Math.min(page, Math.max(1, Math.ceil(matched.length / ROWS_PER_PAGE)));
  const shown = matched.slice((current - 1) * ROWS_PER_PAGE, current * ROWS_PER_PAGE);

  return (
    <>
      <header className="home-head reveal" style={reveal(0)}>
        <p className="eyebrow">{greeting()}，{session.username}<span aria-hidden="true"> · </span>{formatLongDate()}</p>
        <h1 className="headline">
          <i className={cx('led led--lg', urgent ? 'led--warn' : 'led--live')} aria-hidden="true" />
          {urgent > 0
            ? <>有 <b>{urgent}</b> 件事需要你处理。</>
            : sentToday === null
              ? '一切正常。'
              : sentToday > 0
                ? <>一切正常，今天已发出 <b>{formatNumber(sentToday)}</b> 封。</>
                : '一切正常，今天还没有发送。'}
        </h1>
      </header>

      {attention.length ? (
        <ul className="attention reveal" style={reveal(1)} aria-label="需要处理的事">
          {(expanded ? attention : attention.slice(0, ATTENTION_LIMIT)).map(item => (
            <li key={item.key} className={`attention__item attention__item--${item.tone}`}>
              <span className="attention__label">{item.label}</span>
              <p className="attention__text">{item.text}</p>
              <div className="attention__action">{item.action}</div>
            </li>
          ))}
          {attention.length > ATTENTION_LIMIT ? (
            <li className="attention__more">
              <button type="button" className="link" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
                {expanded ? '只看最要紧的几件' : `还有 ${attention.length - ATTENTION_LIMIT} 件，全部展开`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}

      <TrendPanel className="section reveal" style={reveal(2)} trend={trend} />

      <section className="panel table section reveal" style={reveal(3)}>
        <PanelHead icon="users" title="租户">
          {list.length > 8 ? <input className="input input--sm" type="search" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }} placeholder="按名称、ID 或登录账号筛选" aria-label="筛选租户" /> : null}
          <Button size="sm" icon="plus" onClick={newTenant}>新建租户</Button>
        </PanelHead>
        <div className="trow trow--head tenant-row">
          <span>租户</span>
          <span>可用额度</span>
          <span>预计还能用<Tip>按近 7 天的发送速度估算，仅供参考。</Tip></span>
          <span />
        </div>
        {shown.length ? (
          <ul className="table__body">
            {shown.map(tenant => (
              <li key={tenant.customer_id}><TenantRow tenant={tenant} week={stats?.week[tenant.customer_id] ?? 0} /></li>
            ))}
          </ul>
        ) : <EmptyState icon="search" title="没有匹配的租户">换个名称、ID 或登录账号试试。</EmptyState>}
      </section>
      {matched.length > ROWS_PER_PAGE ? <Pager page={current} total={matched.length} pageSize={ROWS_PER_PAGE} unit="个租户" onChange={setPage} /> : null}
    </>
  );
}

/** 一个租户一行，整行点击进入租户页。正常状态只留数值，停用、告急、用完才显式标出来。 */
function TenantRow({ tenant, week }: { tenant: TenantSummary; week: number }) {
  const outlook = forecast(week, tenant.available_count);
  const health = quotaHealth(tenant, outlook.remainingDays);
  const { left, basis } = runway(outlook, health);
  const flag = HEALTH_LABEL[health];

  return (
    <Link className={cx('trow tenant-row', !tenant.enabled && 'is-off')} to={tenantPath(tenant.customer_id)} viewTransition>
      <div className="who">
        <span className="who__avatar">
          <Avatar name={tenant.name} />
          <i className={cx('led', tenant.enabled && 'led--on')} aria-hidden="true" />
        </span>
        <div className="who__text">
          <span className="who__name">
            <span>{tenant.name}</span>
            {tenant.enabled ? <span className="sr-only">运行中</span> : <em className="tag">已停用</em>}
          </span>
          <span className="who__id mono">{tenant.customer_id}</span>
        </div>
      </div>
      <div className="quota-cell">
        <div className="quota-cell__line">
          <b>{formatNumber(tenant.available_count)}</b>
          <span>/ {formatNumber(tenant.quota_total)} 封</span>
          {flag ? <em className={`tag tag--${health}`}>{flag}</em> : null}
        </div>
        <QuotaMeter quota={tenant} health={health} />
      </div>
      <div className={`runway runway--${health}`}>
        <b>{left}</b>
        <span>{basis}</span>
      </div>
      <Icon name="chevron-right" size={16} />
    </Link>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="正在读取">
      <div className="home-head">
        <Skeleton width={220} height={14} />
        <Skeleton width="min(560px, 80%)" height={44} />
      </div>
      <div className="section"><Skeleton width="100%" height={410} /></div>
      <div className="section"><Skeleton width="100%" height={180} /></div>
    </div>
  );
}
