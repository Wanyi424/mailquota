import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { customerLink, dateTime, number, recordsLink } from '../helpers';
import type { Customer, RequestRow } from '../types';
import { Icon } from '../icons';
import { GuardedLink, useAdmin } from '../components/app';
import { Badge, EmptyState, LoadingState, explainError } from '../components/ui';

type DashboardData = { customers: Customer[]; customerTotal: number; pending: RequestRow[]; pendingTotal: number };

export function OverviewPage() {
  const { api, setCrumbs } = useAdmin();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<unknown>();
  const [refresh, setRefresh] = useState(0);

  useEffect(() => { setCrumbs([{ label: '工作台' }]); }, [setCrumbs]);
  useEffect(() => {
    let active = true;
    setError(undefined);
    Promise.all([api.customers(1, 20), api.requests({ status: 'unknown', page: 1, page_size: 5 })]).then(([customers, requests]) => {
      if (active) setData({ customers: customers.items, customerTotal: customers.total, pending: requests.items, pendingTotal: requests.total });
    }).catch(value => { if (active) setError(value); });
    return () => { active = false; };
  }, [api, refresh]);

  const lowCustomers = useMemo(() => data?.customers.filter(customer => customer.enabled && customer.quota_total > 0 && customer.available_count / customer.quota_total <= .1).sort((a, b) => a.available_count - b.available_count).slice(0, 5) || [], [data]);
  const enabledOnPage = data?.customers.filter(customer => customer.enabled).length || 0;
  const availableOnPage = data?.customers.reduce((sum, customer) => sum + customer.available_count, 0) || 0;
  const occupiedOnPage = data?.customers.reduce((sum, customer) => sum + customer.reserved_count, 0) || 0;

  if (!data && !error) return <OverviewFrame><LoadingState /></OverviewFrame>;
  if (error && !data) return <OverviewFrame><div className="inline-error" role="alert"><p>{explainError(error)}</p><button className="button secondary" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh-cw" />重新加载</button></div></OverviewFrame>;
  if (!data) return null;

  return <OverviewFrame>
    {error ? <div className="inline-error" role="alert"><p>{explainError(error)}</p><button className="button secondary" onClick={() => setRefresh(value => value + 1)}><Icon name="refresh-cw" />重新加载</button></div> : null}
    <section className="overview-welcome" aria-label="工作台操作">
      <div />
      {data.pendingTotal > 0 ? <GuardedLink className="button primary" to={recordsLink('unknown')}><Icon name="triangle-alert" />处理待确认 <b>{number(data.pendingTotal)}</b></GuardedLink> : <span className="quiet-status"><Icon name="check" />当前没有待确认记录</span>}
    </section>

    <section className="overview-stat-grid" aria-label="服务概览">
      <OverviewStat label="客户总数" value={data.customerTotal} detail={`${number(enabledOnPage)} 位已启用 · 当前展示前 20 位`} href="/customers" />
      <OverviewStat label="当前可用额度" value={availableOnPage} suffix="封" detail="当前展示客户合计" tone="teal" />
      <OverviewStat label="发送占用" value={occupiedOnPage} suffix="封" detail="当前展示客户合计" tone={occupiedOnPage ? 'amber' : undefined} />
      <OverviewStat label="待确认记录" value={data.pendingTotal} detail={data.pendingTotal ? '需要人工判断后结算' : '发送结果都已明确'} tone={data.pendingTotal ? 'danger' : 'teal'} href={data.pendingTotal ? recordsLink('unknown') : undefined} />
    </section>

    <div className="overview-columns">
      <section className="panel" aria-labelledby="pending-heading">
        <div className="panel-heading"><div className="panel-title"><h2 id="pending-heading">待确认队列</h2></div><GuardedLink className="text-button" to={recordsLink('unknown')}>查看全部</GuardedLink></div>
        {data.pending.length ? <div className="overview-list">{data.pending.map(item => <div className="overview-list-row" key={item.id}><div><span className="overview-row-title">{item.email}</span><p><GuardedLink to={customerLink(item.customer_id)}>{item.customer_id}</GuardedLink><span>·</span>{dateTime(item.created_at)}</p></div><Badge status="unknown" /></div>)}</div> : <EmptyState message="暂无待确认记录" />}
      </section>

      <section className="panel" aria-labelledby="quota-heading">
        <div className="panel-heading"><div className="panel-title"><h2 id="quota-heading">额度风险</h2></div><GuardedLink className="text-button" to="/customers">查看客户</GuardedLink></div>
        {lowCustomers.length ? <div className="overview-list">{lowCustomers.map(customer => <div className="overview-list-row" key={customer.customer_id}><div><GuardedLink className="overview-row-title" to={customerLink(customer.customer_id)}>{customer.name}</GuardedLink><p>{customer.customer_id} · 总额度 {number(customer.quota_total)} 封</p></div><strong className="overview-risk-value">{number(customer.available_count)} 封可用</strong></div>)}</div> : <EmptyState message="当前展示客户中没有低额度客户" />}
      </section>
    </div>
  </OverviewFrame>;
}

function OverviewFrame({ children }: { children: ReactNode }) { return <div className="overview-page">{children}</div>; }

function OverviewStat({ label, value, suffix, detail, tone, href }: { label: string; value: number; suffix?: string; detail: string; tone?: 'teal' | 'amber' | 'danger'; href?: string }) {
  const content = <><span className="overview-stat-label">{label}</span><strong className={`overview-stat-value${tone ? ` ${tone}` : ''}`}>{number(value)}{suffix ? <small>{suffix}</small> : null}</strong><span className="overview-stat-detail">{detail}</span></>;
  return href ? <GuardedLink className="overview-stat" to={href}>{content}</GuardedLink> : <div className="overview-stat">{content}</div>;
}
