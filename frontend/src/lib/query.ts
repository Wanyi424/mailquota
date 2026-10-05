import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// 一个很小的「先显示旧数据、后台刷新」缓存。页面之间共享同一份客户和统计，
// 切换栏目时不会闪白，写操作之后按前缀让相关数据重新读取。

type State<T> = { data: T | undefined; error: unknown; fetching: boolean; at: number };
type Entry = { state: State<unknown>; listeners: Set<() => void>; fetcher: (() => Promise<unknown>) | null; run: number };

const EMPTY: State<unknown> = { data: undefined, error: undefined, fetching: false, at: 0 };
const STALE_AFTER = 30000;
const entries = new Map<string, Entry>();

function entryFor(key: string) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { state: EMPTY, listeners: new Set(), fetcher: null, run: 0 };
    entries.set(key, entry);
  }
  return entry;
}

function publish(entry: Entry, patch: Partial<State<unknown>>) {
  entry.state = { ...entry.state, ...patch };
  for (const listener of entry.listeners) listener();
}

async function run(key: string) {
  const entry = entryFor(key);
  if (!entry.fetcher) return;
  const id = ++entry.run;
  publish(entry, { fetching: true });
  try {
    const data = await entry.fetcher();
    if (id === entry.run) publish(entry, { data, error: undefined, fetching: false, at: Date.now() });
  } catch (error) {
    if (id === entry.run) publish(entry, { error, fetching: false });
  }
}

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>) {
  const subscribe = useCallback((listener: () => void) => {
    if (key === null) return () => {};
    const entry = entryFor(key);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, [key]);
  const state = useSyncExternalStore(subscribe, () => (key === null ? EMPTY : entryFor(key).state)) as State<T>;

  const latest = useRef(fetcher);
  latest.current = fetcher;
  useEffect(() => {
    if (key === null) return;
    const entry = entryFor(key);
    entry.fetcher = () => latest.current();
    if (!entry.state.fetching) void run(key);
  }, [key]);

  const reload = useCallback(() => { if (key !== null) void run(key); }, [key]);
  return {
    data: state.data,
    error: state.error,
    /** 还没有任何可显示的数据。 */
    loading: state.data === undefined && state.error === undefined,
    fetching: state.fetching,
    reload,
  };
}

/** 让以这些前缀开头的数据重新读取；不传前缀表示全部。没人在看的直接丢弃。 */
export function invalidate(...prefixes: string[]) {
  for (const [key, entry] of entries) {
    if (prefixes.length && !prefixes.some(prefix => key.startsWith(prefix))) continue;
    if (entry.listeners.size) void run(key);
    else entries.delete(key);
  }
}

/** 写操作已经带回了最新结果时直接写入，省一次读取。 */
export function setQueryData<T>(key: string, data: T) {
  const entry = entryFor(key);
  entry.run++;
  publish(entry, { data, error: undefined, fetching: false, at: Date.now() });
}

export function clearQueries() {
  entries.clear();
}

// 管理端常常开着放在后台，切回来时把超过半分钟的数据刷新一遍。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.listeners.size && !entry.state.fetching && now - entry.state.at > STALE_AFTER) void run(key);
  }
});
