import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { initTheme } from '../lib/theme';
import { useTitle } from '../shared/title';
import { ButtonLink, EmptyState } from '../ui/controls';
import { AccessPage } from './pages/access';
import { MailPage } from './pages/mail';
import { OverviewPage } from './pages/overview';
import { RecordsPage } from './pages/records';
import { TenantRoot } from './root';
import '../styles/index.css';

initTheme();

function NotFound() {
  useTitle('没有这个页面');
  return (
    <EmptyState icon="circle-help" title="没有这个页面" action={<ButtonLink to="/" icon="arrow-left">回到概览</ButtonLink>}>
      地址可能输错了，或者这个页面已经不存在。
    </EmptyState>
  );
}

// 所有页面都挂在 TenantRoot 之下：未登录时任何地址都显示登录页，登录后原地进入目标页面。
const router = createBrowserRouter([
  {
    element: <TenantRoot />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/login', element: <Navigate to="/" replace /> },
      { path: '/mail', element: <MailPage /> },
      { path: '/records', element: <RecordsPage /> },
      { path: '/access', element: <AccessPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
], { basename: '/tenant' });

const container = document.getElementById('app');
if (!container) throw new Error('租户门户根节点不存在');
createRoot(container).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
