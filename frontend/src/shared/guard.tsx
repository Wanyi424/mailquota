import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { useConfirm } from '../ui/overlay';

const active = new Set<object>();

/** 当前页面上是否有尚未保存的内容（退出登录前要先问一句）。 */
export const hasUnsavedChanges = () => active.size > 0;

type GuardCopy = { title: string; body: string; confirmLabel: string };

const DEFAULT_COPY: GuardCopy = { title: '放弃未保存的修改？', body: '离开这个页面后，刚才的修改不会保留。', confirmLabel: '放弃修改' };

/**
 * 有未保存内容时拦住离开：站内跳转和浏览器前进后退先确认，刷新或关闭标签页交给浏览器自带的提示。
 * 只拦换页，同一页内的查询参数变化（比如打开抽屉）不受影响。
 */
export function useUnsavedGuard(dirty: boolean, copy: GuardCopy = DEFAULT_COPY) {
  const confirm = useConfirm();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const latest = useRef({ blocker, copy });
  latest.current = { blocker, copy };

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({ ...latest.current.copy, danger: true }).then(leave => {
      const current = latest.current.blocker;
      if (current.state !== 'blocked') return;
      if (leave) current.proceed();
      else current.reset();
    });
  }, [blocker.state, confirm]);

  useEffect(() => {
    if (!dirty) return;
    const token = {};
    active.add(token);
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => {
      active.delete(token);
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);
}
