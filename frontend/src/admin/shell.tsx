import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { setTheme, useTheme } from '../lib/theme';
import { Avatar, IconButton, Kbd, cx } from '../ui/controls';
import { BrandMark, Icon } from '../ui/icon';
import { useAdmin } from './context';
import { Palette } from './palette';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

export function Shell({ children }: { children: ReactNode }) {
  const { session, logout } = useAdmin();
  const { resolved } = useTheme();
  const { pathname } = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 换页后把焦点交给主内容，键盘和读屏用户不用再穿过一遍顶栏。
  useEffect(() => {
    const main = document.getElementById('main');
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [pathname]);

  // 租户的各个页面在导航上都归在「总览」之下。
  const section = pathname.startsWith('/records') ? 'records' : 'home';

  return (
    <div className="shell">
      <a className="skip-link" href="#main">跳到主要内容</a>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" className="brand" viewTransition aria-label="MailQuota 总览">
            <BrandMark />
            <span className="brand__word">MailQuota</span>
          </Link>
          <nav className="topnav" aria-label="主导航">
            <Link to="/" viewTransition className={cx(section === 'home' && 'is-active')} aria-current={section === 'home' ? 'page' : undefined}><Icon name="layout-dashboard" size={16} />总览</Link>
            <Link to="/records" viewTransition className={cx(section === 'records' && 'is-active')} aria-current={section === 'records' ? 'page' : undefined}><Icon name="logs" size={16} />发送记录</Link>
          </nav>
          <button type="button" className="searchbox" onClick={() => setPaletteOpen(true)} aria-label="搜索邮箱、租户或操作" aria-keyshortcuts="Control+K Meta+K">
            <Icon name="search" size={16} />
            <span className="searchbox__text">搜索邮箱、租户或操作</span>
            <Kbd>{isMac ? '⌘' : 'Ctrl'} K</Kbd>
          </button>
          <div className="topbar__tools">
            <IconButton icon={resolved === 'dark' ? 'sun' : 'moon'} label={resolved === 'dark' ? '切换到浅色' : '切换到深色'} onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} />
            <span className="account"><Avatar name={session.username} size="sm" /><span className="account__name">{session.username}</span></span>
            <IconButton icon="log-out" label="退出登录" onClick={() => void logout()} />
          </div>
        </div>
      </header>
      <main id="main" className="page" tabIndex={-1}>{children}</main>
      {paletteOpen ? <Palette onClose={() => setPaletteOpen(false)} /> : null}
    </div>
  );
}
