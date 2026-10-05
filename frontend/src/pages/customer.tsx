import { useCallback, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useAdmin, useTitle } from '../app/admin';
import { describeForecast, explainError, forecast, formatDateTime, formatNumber, formatRelative, HEALTH_LABEL, quotaHealth } from '../lib/format';
import { invalidate, setQueryData, useQuery } from '../lib/query';
import type { Customer, CustomerChanges, CustomerDetail } from '../types';
import { Avatar, Button, ButtonLink, CopyButton, EmptyState, ErrorState, IconButton, Notice, PanelHead, Skeleton, StatusBadge, Switch, Tip, cx } from '../ui/controls';
import { Icon } from '../ui/icon';
import { Odometer, QuotaMeter } from '../ui/meter';
import { useConfirm, useToast } from '../ui/overlay';
import { RecordLink, Records, useRecordDrawer } from './records';
import { TrendPanel, useTrend } from './trend';

type CustomerOutlet = { customer: CustomerDetail };

/** 客户各栏目共用同一份客户数据，切换栏目不重新读取。 */
export const useCustomer = () => useOutletContext<CustomerOutlet>();

/** 保存客户的若干项修改，并让其它页面看到最新结果。版本冲突时读回最新配置再把错误交给调用方。 */
export function useSaveCustomer() {
  const { api } = useAdmin();
  return useCallback(async (customer: Customer, changes: CustomerChanges) => {
    try {
      const saved = await api.updateCustomer(customer.customer_id, customer.version, changes);
      setQueryData(`customer:${customer.customer_id}`, saved);
      invalidate('customers');
      return saved;
    } catch (error) {
      if ((error as { code?: string }).code === 'EDIT_CONFLICT') invalidate(`customer:${customer.customer_id}`);
      throw error;
    }
  }, [api]);
}

/**
 * 客户页的外框。头部是这位客户的身份和两个全局操作：运行开关、加额度。
 * 这两个操作只在这里出现，各栏目里不再重复摆放。
 */
export function CustomerLayout() {
  const { id = '' } = useParams();
  const { api, topUp } = useAdmin();
  const customer = useQuery(`customer:${id}`, () => api.customer(id));
  useTitle(customer.data?.name ?? '客户');

  if (customer.loading) {
    return (
      <div aria-busy="true" aria-label="正在读取">
        <div className="workspace-head"><Skeleton width={56} height={56} /><Skeleton width={260} height={34} /></div>
        <div className="section"><Skeleton width="100%" height={320} /></div>
      </div>
    );
  }
  if (!customer.data) {
    return (customer.error as { code?: string })?.code === 'CUSTOMER_NOT_FOUND'
      ? <EmptyState icon="circle-help" title="没有这个客户" action={<ButtonLink to="/" icon="arrow-left">回到总览</ButtonLink>}>地址里的客户 ID 不存在，可能是输错了。</EmptyState>
      : <ErrorState error={customer.error} onRetry={customer.reload} />;
  }

  const data = customer.data;
  const tab = ({ isActive }: { isActive: boolean }) => cx('tabs__item', isActive && 'is-active');
  return (
    <>
      <Link className="back" to="/" viewTransition><Icon name="arrow-left" size={15} />总览</Link>
      <header className="workspace-head">
        <Avatar name={data.name} size="lg" />
        <div className="workspace-head__main">
          <NameEditor customer={data} />
          <div className="workspace-head__meta">
            <span className="mono">{data.customer_id}</span>
            <CopyButton value={data.customer_id} label="复制客户 ID" />
          </div>
        </div>
        <div className="workspace-head__actions">
          <EnableSwitch customer={data} />
          <Button variant="primary" icon="plus" onClick={() => topUp(data)}>加额度</Button>
        </div>
      </header>

      <nav className="tabs" aria-label="客户栏目">
        {/* 概览、记录和顶部导航的总览、发送记录是同一个概念，用同一个图标。 */}
        <NavLink to="." end className={tab} viewTransition><Icon name="layout-dashboard" size={16} />概览</NavLink>
        <NavLink to="email" className={tab} viewTransition><Icon name="mail" size={16} />邮件</NavLink>
        <NavLink to="access" className={tab} viewTransition><Icon name="plug" size={16} />接入</NavLink>
        <NavLink to="records" className={tab} viewTransition><Icon name="logs" size={16} />记录</NavLink>
      </nav>

      {customer.error ? (
        <Notice tone="warn" icon="triangle-alert" action={<Button size="sm" onClick={customer.reload}>重试</Button>}>
          没能读到最新数据，下面显示的是上一次的结果。{explainError(customer.error)}
        </Notice>
      ) : null}

      <Outlet context={{ customer: data } satisfies CustomerOutlet} />
    </>
  );
}

/**
 * 客户名称原地修改：输入框和标题用同一套字号、同一个固定行高，
 * 进入和退出编辑时页面上没有任何东西移动。回车保存，Esc 取消。
 */
function NameEditor({ customer }: { customer: CustomerDetail }) {
  const save = useSaveCustomer();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (draft === null) {
    return (
      <div className="title">
        <h1 className="title__text" title={customer.name}>{customer.name}</h1>
        <IconButton icon="pencil" label="修改客户名称" onClick={() => setDraft(customer.name)} />
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (!next || next === customer.name) {
      setDraft(null);
      return;
    }
    setBusy(true);
    try {
      await save(customer, { name: next });
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
          aria-label="客户名称"
        />
      </span>
      <IconButton type="submit" icon="check" label="保存名称" busy={busy} />
      <IconButton icon="x" label="取消修改" disabled={busy} onClick={() => setDraft(null)} />
    </form>
  );
}

/** 运行开关：状态和操作是同一个控件。关闭会让客户的调用全部失败，所以关之前确认一次；打开不需要。 */
function EnableSwitch({ customer }: { customer: CustomerDetail }) {
  const save = useSaveCustomer();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const toggle = async (enable: boolean) => {
    if (!enable && !await confirm({
      title: `停用「${customer.name}」？`,
      body: '停用后，这位客户的发送、核验和查询都会被拒绝，已经发出的验证码也无法核验。额度和记录都保留，之后随时可以重新打开。',
      confirmLabel: '停用',
      danger: true,
    })) return;
    setBusy(true);
    try {
      await save(customer, { enabled: enable });
      toast(enable ? `「${customer.name}」已启用，客户后端可以调用了。` : `「${customer.name}」已停用。`);
    } catch (error) {
      toast(explainError(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Switch checked={customer.enabled} disabled={busy} label="允许客户后端调用" onChange={enable => void toggle(enable)}>
      {customer.enabled ? '运行中' : '已停用'}
    </Switch>
  );
}

export function CustomerOverview() {
  const { customer } = useCustomer();
  const { api } = useAdmin();
  const trend = useTrend();
  const id = customer.customer_id;
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

  const outlook = forecast(trend.stats?.customers[id], customer.available_count);
  const health = quotaHealth(customer, outlook.remainingDays);
  const flag = HEALTH_LABEL[health];
  const verdict = health === 'unset' ? '还没有设置额度，发送会被拒绝' : health === 'empty' ? '额度已用完，新的验证码发不出去' : describeForecast(outlook);

  return (
    <div className="overview">
      {customer.enabled ? null : (
        <Notice tone="info" icon="info">这位客户已停用，发送、核验和查询都会被拒绝。打开右上角的开关即可恢复，额度和记录都还在。</Notice>
      )}

      <section className="panel quota-panel reveal">
        <PanelHead icon="gauge" title="可用额度">{flag ? <em className={`tag tag--${health}`}>{flag}</em> : null}</PanelHead>
        <div className="readout readout--hero"><Odometer value={customer.available_count} /><span className="readout__unit">封</span></div>
        <QuotaMeter quota={customer} health={health} large />
        <dl className="split">
          <div><dt>已用</dt><dd>{formatNumber(customer.used_count)}</dd></div>
          {/* 占用通常是 0，只在真的有邮件占着额度时才出现。 */}
          {customer.reserved_count > 0 ? (
            <div>
              <dt>占用中<Tip>发送中或结果不明的邮件暂时占着的额度，有了结果就转为已用或退回。</Tip></dt>
              <dd>{formatNumber(customer.reserved_count)}</dd>
            </div>
          ) : null}
          <div><dt>总额度</dt><dd>{formatNumber(customer.quota_total)}</dd></div>
        </dl>
        <p className={`forecast forecast--${health}`}>
          {health === 'ok' ? null : <Icon name="triangle-alert" size={15} />}
          {verdict}
        </p>
      </section>

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
                  <time dateTime={new Date(row.created_at).toISOString()} title={formatDateTime(row.created_at)}>{formatRelative(row.created_at)}</time>
                </RecordLink>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TrendPanel className="reveal" trend={trend} customerId={id} />
      {records.drawer}
    </div>
  );
}

export function CustomerRecords() {
  const { customer } = useCustomer();
  return <Records customerId={customer.customer_id} />;
}
