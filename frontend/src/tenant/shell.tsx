import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { setTheme, useTheme } from '../lib/theme';
import { Avatar, IconButton, cx } from '../ui/controls';
import { BrandMark, Icon } from '../ui/icon';
import { usePortal } from './context';

export function Shell({ children }: { children: ReactNode }) {
  const { session, logout } = usePortal();
  const { resolved } = useTheme();
  const { pathname } = useLocation();

  // 换页后把焦点交给主内容，键盘和读屏用户不用再穿过一遍顶栏。
  useEffect(() => {
    const main = document.getElementById('main');
    if (main && !main.contains(document.activeElement)) main.focus({ preventScroll: true });
  }, [pathname]);

  const link = ({ isActive }: { isActive: boolean }) => cx(isActive && 'is-active');

  return (
    <div className="shell">
      <a className="skip-link" href="#main">跳到主要内容</a>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/" className="brand" viewTransition aria-label="MailQuota 概览">
            <BrandMark />
            <span className="brand__word">MailQuota</span>
          </Link>
          <nav className="topnav" aria-label="主导航">
            <NavLink to="/" end className={link} viewTransition><Icon name="layout-dashboard" size={16} />概览</NavLink>
            <NavLink to="/mail" className={link} viewTransition><Icon name="mail" size={16} />邮件</NavLink>
            <NavLink to="/records" className={link} viewTransition><Icon name="logs" size={16} />发送记录</NavLink>
            <NavLink to="/access" className={link} viewTransition><Icon name="plug" size={16} />接入</NavLink>
          </nav>
          <div className="topbar__tools">
            <IconButton icon={resolved === 'dark' ? 'sun' : 'moon'} label={resolved === 'dark' ? '切换到浅色' : '切换到深色'} onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')} />
            <span className="account" title={`登录账号：${session.login_name}`}><Avatar name={session.name} size="sm" /><span className="account__name">{session.name}</span></span>
            <IconButton icon="log-out" label="退出登录" onClick={() => void logout()} />
          </div>
        </div>
      </header>
      <main id="main" className="page" tabIndex={-1}>{children}</main>
    </div>
  );
}
