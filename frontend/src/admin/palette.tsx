import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '../lib/query';
import { setTheme } from '../lib/theme';
import { Kbd, cx } from '../ui/controls';
import { Icon, type IconName } from '../ui/icon';
import { Overlay, useClose } from '../ui/overlay';
import { tenantPath, useAdmin } from './context';

type Command = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: IconName;
  /** 除了标题之外也参与匹配的词。 */
  keywords?: string;
  run: () => void;
};

// 租户可能有几百个：每一类最多列出这么多，其余的靠输入关键词缩小范围。
const PER_GROUP = 6;
const TENANT_GROUPS = ['加额度', '租户'];

/** 全局搜索与快捷操作：查邮箱、跳到租户、加额度，都从这里一步到位。 */
export function Palette({ onClose }: { onClose: () => void }) {
  // 选中的操作等面板退场后再执行，避免两个浮层的动画叠在一起。
  const pending = useRef<(() => void) | null>(null);
  return (
    <Overlay kind="palette" label="搜索与快捷操作" onClose={() => { onClose(); pending.current?.(); }}>
      <PaletteBody onPick={run => { pending.current = run; }} />
    </Overlay>
  );
}

function PaletteBody({ onPick }: { onPick: (run: () => void) => void }) {
  const { api, logout, adjustQuota, newTenant } = useAdmin();
  const navigate = useNavigate();
  const close = useClose();
  const tenants = useQuery('tenants', api.tenants).data;
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const commands = useMemo(() => {
    const go = (to: string) => () => { void navigate(to, { viewTransition: true }); };
    const all: Command[] = [];
    for (const tenant of tenants ?? []) {
      all.push({ id: `quota:${tenant.customer_id}`, group: '加额度', label: `给「${tenant.name}」加额度`, icon: 'plus', keywords: `${tenant.customer_id} ${tenant.login_name} 额度 充值 quota`, run: () => adjustQuota(tenant) });
    }
    for (const tenant of tenants ?? []) {
      all.push({ id: `open:${tenant.customer_id}`, group: '租户', label: tenant.name, hint: tenant.customer_id, icon: 'arrow-right', keywords: `${tenant.customer_id} ${tenant.login_name}`, run: go(tenantPath(tenant.customer_id)) });
    }
    all.push(
      { id: 'new', group: '操作', label: '新建租户', icon: 'user-plus', keywords: '创建 接入 new', run: newTenant },
      { id: 'records', group: '操作', label: '查看全部发送记录', icon: 'logs', keywords: '流水 日志 records', run: go('/records') },
      { id: 'home', group: '操作', label: '回到总览', icon: 'layout-dashboard', keywords: '首页 home', run: go('/') },
      { id: 'light', group: '外观', label: '使用浅色主题', icon: 'sun', keywords: 'theme light 白天', run: () => setTheme('light') },
      { id: 'dark', group: '外观', label: '使用深色主题', icon: 'moon', keywords: 'theme dark 夜间', run: () => setTheme('dark') },
      { id: 'system', group: '外观', label: '主题跟随系统', icon: 'monitor', keywords: 'theme system 自动', run: () => setTheme('system') },
      { id: 'logout', group: '账号', label: '退出登录', icon: 'log-out', keywords: 'logout 登出', run: () => { void logout(); } },
    );
    return all;
  }, [tenants, logout, navigate, newTenant, adjustQuota]);

  const visible = useMemo(() => {
    const text = query.trim();
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const shown: Record<string, number> = {};
    const matched = commands.filter(command => {
      const haystack = `${command.label} ${command.hint ?? ''} ${command.keywords ?? ''}`.toLowerCase();
      if (!words.every(word => haystack.includes(word))) return false;
      if (!TENANT_GROUPS.includes(command.group)) return true;
      shown[command.group] = (shown[command.group] ?? 0) + 1;
      return shown[command.group] <= PER_GROUP;
    });
    if (!text) return matched;
    const lookup: Command = {
      id: 'lookup',
      group: '发送记录',
      label: `查找「${text}」的发送记录`,
      hint: '邮箱的一部分，或完整的请求编号',
      icon: 'search',
      run: () => { void navigate(`/records?q=${encodeURIComponent(text)}`, { viewTransition: true }); },
    };
    // 看起来像邮箱的输入，默认动作就是查记录；否则先给匹配到的租户和操作。
    return /[@.]/.test(text) ? [lookup, ...matched] : [...matched, lookup];
  }, [commands, navigate, query]);

  const selected = Math.min(cursor, visible.length - 1);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, visible]);

  const pick = (command: Command | undefined) => {
    if (!command) return;
    onPick(command.run);
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((selected + step + visible.length) % visible.length);
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      pick(visible[selected]);
    }
  };

  return (
    <div className="palette">
      <div className="palette__search">
        <Icon name="search" size={18} />
        <input
          data-autofocus
          value={query}
          onChange={event => { setQuery(event.target.value); setCursor(0); }}
          onKeyDown={onKeyDown}
          placeholder="输入邮箱查发送记录，或搜索租户和操作"
          aria-label="搜索"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          autoComplete="off"
          spellCheck={false}
        />
        <Kbd>Esc</Kbd>
      </div>
      <div className="palette__list" id="palette-list" role="listbox" ref={list}>
        {visible.map((command, index) => (
          <div key={command.id}>
            {index === 0 || visible[index - 1].group !== command.group ? <div className="palette__group">{command.group}</div> : null}
            <button type="button" role="option" aria-selected={index === selected} className={cx('palette__item', index === selected && 'is-selected')} tabIndex={-1} onMouseMove={() => setCursor(index)} onClick={() => pick(command)}>
              <Icon name={command.icon} size={16} />
              <span className="palette__label">{command.label}</span>
              {command.hint ? <span className="palette__hint">{command.hint}</span> : null}
            </button>
          </div>
        ))}
      </div>
      <footer className="palette__foot" aria-hidden="true">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> 选择</span>
        <span><Kbd>Enter</Kbd> 确认</span>
      </footer>
    </div>
  );
}
