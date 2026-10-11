import { useRef, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { briefReason, explainRecord, formatDateTime, formatRelative, recordCaveat } from '../../lib/format';
import { seedQueryData, useQuery } from '../../lib/query';
import { Pager, RecordsToolbar, usePageOverflow, useRecordFilters } from '../../shared/records';
import { useTitle } from '../../shared/title';
import type { Page } from '../../types';
import { CopyButton, EmptyState, ErrorState, Skeleton, StatusBadge, cx } from '../../ui/controls';
import { Icon } from '../../ui/icon';
import { Drawer } from '../../ui/overlay';
import { useMe, usePortal } from '../context';
import type { RequestRow } from '../types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 自己的发送流水：谁、什么时候、发出去没有。不含验证码和邮件正文。 */
export function RecordsPage() {
  const { api } = usePortal();
  const filters = useRecordFilters();
  // 有额度被占着，才可能存在结果不明的记录。
  const reserved = useMe().data?.reserved_count ?? 0;
  const { recordId, drawer } = useRecordDrawer();
  useTitle('发送记录');

  const list = useQuery(filters.rangeError ? null : `requests:${JSON.stringify(filters.query)}`, () => api.requests(filters.query));
  // 换筛选条件时先留着上一批结果（变淡），新结果到了再替换，列表不会闪成空白。
  const previous = useRef<Page<RequestRow> | undefined>(undefined);
  if (list.data) previous.current = list.data;
  const data = list.data ?? (list.error ? undefined : previous.current);
  const overflow = usePageOverflow(filters, list.data);
  const rowClass = 'trow record-row record-row--scoped';

  return (
    <>
      <header className="page-head reveal"><h1>发送记录</h1></header>
      <div className="records reveal">
        <RecordsToolbar filters={filters} unknown={reserved > 0} />

        <div className={cx('panel table', list.fetching && data && 'is-refreshing')}>
          <div className={cx(rowClass, 'trow--head')}>
            <span>状态</span>
            <span>收件邮箱</span>
            <span>说明</span>
            <span className="record__time">时间</span>
            <span />
          </div>
          {filters.rangeError ? (
            <EmptyState icon="calendar-days" title="日期范围不对">{filters.rangeError}</EmptyState>
          ) : !data && !list.error || overflow ? (
            <div className="records__skeleton" aria-busy="true" aria-label="正在读取">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} width="100%" height={22} />)}
            </div>
          ) : !data ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : data.items.length === 0 ? (
            filters.active
              ? <EmptyState icon="search" title="没有符合条件的记录">{filters.q ? '邮箱按包含匹配，请求编号需要完整粘贴。换个关键词，或放宽其它筛选条件。' : '放宽筛选条件再看看。'}</EmptyState>
              : <EmptyState icon="send" title="还没有发送记录">业务后端调用发送接口之后，每一封都会出现在这里。</EmptyState>
          ) : (
            <ul className="table__body">
              {data.items.map(row => (
                <li key={row.request_id}>
                  <RecordLink row={row} className={cx(rowClass, row.request_id === recordId && 'is-open')}>
                    <StatusBadge status={row.status} />
                    <span className="record__email mono">{row.email}</span>
                    <span className="record__note">{briefReason(row.smtp_error_code)}</span>
                    <time className="record__time" dateTime={row.created_at} title={formatDateTime(row.created_at)}>{formatRelative(row.created_at)}</time>
                    <Icon name="chevron-right" size={16} />
                  </RecordLink>
                </li>
              ))}
            </ul>
          )}
        </div>

        {data && data.total > 0 ? (
          <Pager page={filters.page} total={data.total} note="北京时间" onChange={next => filters.update({ page: next > 1 ? String(next) : null }, { keepPage: true, replace: false, keepScroll: false })} />
        ) : null}

        {drawer}
      </div>
    </>
  );
}

/** 指向某条记录详情的链接：在当前地址上加一个 record 参数，其它筛选条件原样保留。 */
export function RecordLink({ row, className, children }: { row: RequestRow; className?: string; children: ReactNode }) {
  const [params] = useSearchParams();
  const next = new URLSearchParams(params);
  next.set('record', row.request_id);
  return (
    <Link className={className} to={{ search: next.toString() }} state={{ fromList: true }} preventScrollReset onClick={() => seedQueryData<RequestRow | null>(`record:${row.request_id}`, row)}>
      {children}
    </Link>
  );
}

/** 记录详情抽屉由地址里的 record 参数（请求编号）驱动，任何列出记录的页面都可以就地打开它。 */
export function useRecordDrawer() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const raw = params.get('record') ?? '';
  const recordId = UUID.test(raw) ? raw.toLowerCase() : null;

  const close = () => {
    // 从列表点开的抽屉，关闭就是后退一步；直接打开带 record 参数的地址时没有可退的一步。
    if ((location.state as { fromList?: boolean } | null)?.fromList) {
      void navigate(-1);
      return;
    }
    const next = new URLSearchParams(window.location.search);
    next.delete('record');
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return { recordId, drawer: recordId ? <RecordDrawer key={recordId} id={recordId} onClose={close} /> : null };
}

function RecordDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { api } = usePortal();
  // 没有读单条的接口：用请求编号去搜，命中的就是它。
  const record = useQuery(`record:${id}`, async () => (await api.requests({ q: id, page: 1, page_size: 1 })).items[0] ?? null);
  const row = record.data;
  return (
    <Drawer label="发送记录详情" onClose={onClose} header="发送记录">
      {record.loading ? (
        <div className="records__skeleton" aria-busy="true"><Skeleton width="40%" height={24} /><Skeleton width="80%" height={28} /><Skeleton width="100%" height={220} /></div>
      ) : row ? (
        <RecordDetail row={row} />
      ) : record.error ? (
        <ErrorState error={record.error} onRetry={record.reload} />
      ) : (
        <EmptyState icon="circle-help" title="没有这条记录">地址里的请求编号不存在。</EmptyState>
      )}
    </Drawer>
  );
}

function RecordDetail({ row }: { row: RequestRow }) {
  const caveat = recordCaveat(row);
  return (
    <>
      <div className="record-hero">
        <StatusBadge status={row.status} size="lg" />
        <div className="record-hero__email">
          <span className="mono">{row.email}</span>
          <CopyButton value={row.email} label="复制邮箱" />
        </div>
        <p className="record-hero__story">{explainRecord(row, true)}</p>
        {caveat ? <p className="record-hero__caveat">{caveat}</p> : null}
      </div>

      <dl className="kv kv--detail">
        <div><dt>提交时间</dt><dd>{formatDateTime(row.created_at)}</dd></div>
        {row.status === 'pending' ? null : <div><dt>更新时间</dt><dd>{formatDateTime(row.updated_at)}</dd></div>}
        {/* 明确没发出去的邮件，里面的验证码已经作废。 */}
        {row.status === 'failed' ? null : <div><dt>验证码有效至</dt><dd>{formatDateTime(row.code_expires_at)}</dd></div>}
        <div><dt>可再次发送</dt><dd>{formatDateTime(row.resend_available_at)}<span className="muted">同一邮箱 60 秒内只发一封</span></dd></div>
        <div><dt>请求编号</dt><dd><span className="mono">{row.request_id}</span><CopyButton value={row.request_id} label="复制请求编号" /></dd></div>
        {row.smtp_message_id ? <div><dt>Message-ID</dt><dd><span className="mono">{row.smtp_message_id}</span></dd></div> : null}
        {row.smtp_error_code ? <div><dt>错误代码</dt><dd><span className="mono">{row.smtp_error_code}</span>{row.smtp_error_detail ? <span className="muted">{row.smtp_error_detail}</span> : null}</dd></div> : null}
      </dl>
      <p className="drawer__foot">时间均为北京时间。这里不显示验证码和邮件正文。</p>
    </>
  );
}
