import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { explainError, formatDateTime, formatNumber, formatRelative } from '../../lib/format';
import { invalidate, setQueryData, useQuery } from '../../lib/query';
import { QuotaPanel } from '../../shared/quota-panel';
import { Pager } from '../../shared/records';
import { useTitle } from '../../shared/title';
import { TrendPanel, useTrend } from '../../shared/trend';
import type { Page, Tenant } from '../../types';
import { Avatar, Button, ButtonLink, CopyButton, EmptyState, ErrorState, IconButton, Notice, PanelHead, Skeleton, StatusBadge, Switch, cx } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import { useConfirm, useToast } from '../../ui/overlay';
import { ADJUSTMENT_PAGE_SIZE } from '../api';
import { useAdmin } from '../context';
import type { QuotaAdjustment, TenantChanges } from '../types';
import { RecordLink, Records, useRecordDrawer } from './records';

type TenantOutlet = { tenant: Tenant };

/** 租户各栏目共用同一份租户数据，切换栏目不重新读取。 */
export const useTenant = () => useOutletContext<TenantOutlet>();

/** 保存租户的若干项修改，并让其它页面看到最新结果。版本冲突时读回最新配置再把错误交给调用方。 */
export function useSaveTenant() {
  const { api } = useAdmin();
  return useCallback(async (tenant: Tenant, changes: TenantChanges) => {
    try {
      const saved = await api.updateTenant(tenant.customer_id, tenant.version, changes);
      setQueryData(`tenant:${tenant.customer_id}`, saved);
      invalidate('tenants');
      return saved;
    } catch (error) {
      if ((error as { code?: string }).code === 'EDIT_CONFLICT') invalidate(`tenant:${tenant.customer_id}`);
      throw error;
    }
  }, [api]);
}

/**
 * 租户页的外框。头部是这个租户的身份和两个全局操作：运行开关、调整额度。
 * 这两个操作只在这里出现，各栏目里不再重复摆放。
 */
export function TenantLayout() {
  const { id = '' } = useParams();
  const { api, adjustQuota } = useAdmin();
  const tenant = useQuery(`tenant:${id}`, () => api.tenant(id));
  useTitle(tenant.data?.name ?? '租户');

  if (tenant.loading) {
    return (
      <div aria-busy="true" aria-label="正在读取">
        <div className="workspace-head"><Skeleton width={56} height={56} /><Skeleton width={260} height={34} /></div>
        <div className="section"><Skeleton width="100%" height={320} /></div>
      </div>
    );
  }
  if (!tenant.data) {
    return (tenant.error as { code?: string })?.code === 'TENANT_NOT_FOUND'
      ? <EmptyState icon="circle-help" title="没有这个租户" action={<ButtonLink to="/" icon="arrow-left">回到总览</ButtonLink>}>地址里的客户 ID 不存在，可能是输错了。</EmptyState>
      : <ErrorState error={tenant.error} onRetry={tenant.reload} />;
  }

  const data = tenant.data;
  const tab = ({ isActive }: { isActive: boolean }) => cx('tabs__item', isActive && 'is-active');
  return (
    <>
      <Link className="back" to="/" viewTransition><Icon name="arrow-left" size={15} />总览</Link>
      <header className="workspace-head">
        <Avatar name={data.name} size="lg" />
        <div className="workspace-head__main">
          <NameEditor tenant={data} />
          <div className="workspace-head__meta">
            <span className="mono">{data.customer_id}</span>
            <CopyButton value={data.customer_id} label="复制客户 ID" />
          </div>
        </div>
        <div className="workspace-head__actions">
          <EnableSwitch tenant={data} />
          <Button variant="primary" icon="plus" onClick={() => adjustQuota(data)}>调整额度</Button>
        </div>
      </header>

      <nav className="tabs" aria-label="租户栏目">
        {/* 概览、记录和顶部导航的总览、发送记录是同一个概念，用同一个图标。 */}
        <NavLink to="." end className={tab} viewTransition><Icon name="layout-dashboard" size={16} />概览</NavLink>
        <NavLink to="mail" className={tab} viewTransition><Icon name="mail" size={16} />邮件</NavLink>
        <NavLink to="access" className={tab} viewTransition><Icon name="plug" size={16} />接入</NavLink>
        <NavLink to="records" className={tab} viewTransition><Icon name="logs" size={16} />记录</NavLink>
      </nav>

      {tenant.error ? (
        <Notice tone="warn" icon="triangle-alert" action={<Button size="sm" onClick={tenant.reload}>重试</Button>}>
          没能读到最新数据，下面显示的是上一次的结果。{explainError(tenant.error)}
        </Notice>
      ) : null}

      <Outlet context={{ tenant: data } satisfies TenantOutlet} />
    </>
  );
}

/**
 * 租户名称原地修改：输入框和标题用同一套字号、同一个固定行高，
 * 进入和退出编辑时页面上没有任何东西移动。回车保存，Esc 取消。
 */
function NameEditor({ tenant }: { tenant: Tenant }) {
  const save = useSaveTenant();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (draft === null) {
    return (
      <div className="title">
        <h1 className="title__text" title={tenant.name}>{tenant.name}</h1>
        <IconButton icon="pencil" label="修改租户名称" onClick={() => setDraft(tenant.name)} />
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next || next === tenant.name) {
      setDraft(null);
      return;
    }
    setBusy(true);
    try {
      await save(tenant, { name: next });
      setDraft(null);
    } catch (error) {
      toast(explainError(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="title" onSubmit={submit}>
      {/* 隐形的同款文字撑出宽度，输入框盖在它上面：框的宽度始终等于文字的宽度。 */}
      <span className="title__sizer" data-value={draft}>
        <input
          className="title__input"
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape') setDraft(null); }}
          onFocus={event => event.target.select()}
          // 输入框自带的默认宽度约 20 个字，设成 1 才不会把这一格撑得比文字宽。
          size={1}
          maxLength={200}
          required
          autoFocus
          readOnly={busy}
          aria-label="租户名称"
        />
      </span>
      <IconButton type="submit" icon="check" label="保存名称" busy={busy} />
      <IconButton icon="x" label="取消修改" disabled={busy} onClick={() => setDraft(null)} />
    </form>
  );
}

/** 运行开关：状态和操作是同一个控件。关闭会让租户的调用全部失败，所以关之前确认一次；打开不需要。 */
function EnableSwitch({ tenant }: { tenant: Tenant }) {
  const save = useSaveTenant();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const toggle = async (enable: boolean) => {
    if (!enable && !await confirm({
      title: `停用「${tenant.name}」？`,
      body: '停用后，这个租户的发送、核验和查询都会被拒绝，已经发出的验证码也无法核验，门户账号也不能再登录。额度和记录都保留，之后随时可以重新打开。',
      confirmLabel: '停用',
      danger: true,
    })) return;
    setBusy(true);
    try {
      await save(tenant, { enabled: enable });
      toast(enable ? `「${tenant.name}」已启用，业务后端可以调用了。` : `「${tenant.name}」已停用。`);
    } catch (error) {
      toast(explainError(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Switch checked={tenant.enabled} disabled={busy} label="允许业务后端调用" onChange={enable => void toggle(enable)}>
      {tenant.enabled ? '运行中' : '已停用'}
    </Switch>
  );
}

export function TenantOverview() {
  const { tenant } = useTenant();
  const { api } = useAdmin();
  const id = tenant.customer_id;
  const trend = useTrend(`stats/tenant/${id}`, days => api.stats(days, id));
  const recent = useQuery(`requests:recent:${id}`, () => api.requests({ customer_id: id, page: 1, page_size: 6 }));
  const records = useRecordDrawer(true);

  // 预估要用到统计数据，等它到了再画，避免额度面板先是一个样子、随后又变一次。
  if (!trend.stats && !trend.error) {
    return (
      <div className="overview" aria-busy="true" aria-label="正在读取">
        <Skeleton width="100%" height={300} />
        <Skeleton width="100%" height={300} />
      </div>
    );
  }

  return (
    <div className="overview">
      {tenant.enabled ? null : (
        <Notice tone="info" icon="info">这个租户已停用，发送、核验和查询都会被拒绝。打开右上角的开关即可恢复，额度和记录都还在。</Notice>
      )}

      <QuotaPanel quota={tenant} week={trend.stats?.week[id] ?? 0} />

      <section className="panel reveal">
        <PanelHead icon="history" title="最近发送">
          <Link className="link" to="records" viewTransition>全部记录<Icon name="arrow-right" size={14} /></Link>
        </PanelHead>
        {recent.loading ? <Skeleton width="100%" height={200} /> : !recent.data ? <ErrorState error={recent.error} onRetry={recent.reload} /> : recent.data.items.length === 0 ? (
          <p className="panel__empty">还没有发送过邮件。</p>
        ) : (
          <ul className="mini-records">
            {recent.data.items.map(row => (
              <li key={row.id}>
                <RecordLink row={row} className={cx(row.id === records.recordId && 'is-open')}>
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
      <Adjustments id={id} />
      {records.drawer}
    </div>
  );
}

/** 调额历史：每一次增减、调整前后的总额度和原因。创建时设置的初始额度不算一次调整。 */
function Adjustments({ id }: { id: string }) {
  const { api } = useAdmin();
  const [page, setPage] = useState(1);
  const list = useQuery(`adjustments:${id}:${page}`, () => api.adjustments(id, page));
  // 翻页时先留着上一页，新的一页到了再替换。
  const kept = useRef<Page<QuotaAdjustment> | undefined>(undefined);
  if (list.data) kept.current = list.data;
  const data = list.data ?? (list.error ? undefined : kept.current);

  return (
    <div className="ledger reveal">
      <section className={cx('panel table', list.fetching && data && 'is-refreshing')}>
        <PanelHead icon="arrow-up-down" title="调额记录" tip="每一次增加或减少总额度都会记在这里。创建租户时设置的初始额度不算调整。" />
        {!data ? (
          list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : <div className="records__skeleton" aria-busy="true"><Skeleton width="100%" height={22} /><Skeleton width="100%" height={22} /></div>
        ) : data.items.length === 0 ? (
          <p className="panel__empty ledger__empty">还没有调整过额度。</p>
        ) : (
          <>
            <div className="trow trow--head ledger-row">
              <span>变化</span>
              <span>总额度</span>
              <span>原因</span>
              <span className="record__time">时间</span>
            </div>
            <ul className="table__body">
              {data.items.map(item => (
                <li key={item.id} className="trow ledger-row">
                  <b className={cx('ledger__delta', item.delta < 0 && 'is-minus')}>{item.delta > 0 ? '+' : '−'}{formatNumber(Math.abs(item.delta))}</b>
                  <span className="ledger__totals">{formatNumber(item.before_total)} → {formatNumber(item.after_total)}</span>
                  <span className="ledger__reason" title={item.reason ?? undefined}>{item.reason || '—'}</span>
                  <time className="record__time" dateTime={item.created_at} title={`${formatDateTime(item.created_at)}，由 ${item.actor_id} 操作`}>{formatRelative(item.created_at)}</time>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {data && data.total > ADJUSTMENT_PAGE_SIZE ? <Pager page={page} total={data.total} pageSize={ADJUSTMENT_PAGE_SIZE} unit="次" onChange={setPage} /> : null}
    </div>
  );
}

export function TenantRecords() {
  const { tenant } = useTenant();
  return <Records customerId={tenant.customer_id} />;
}
