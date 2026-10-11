import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { initTheme } from '../lib/theme';
import { useTitle } from '../shared/title';
import { ButtonLink, EmptyState } from '../ui/controls';
import { HomePage } from './pages/home';
import { RecordsPage } from './pages/records';
import { TenantLayout, TenantOverview, TenantRecords } from './pages/tenant';
import { TenantAccess } from './pages/tenant-access';
import { TenantMail } from './pages/tenant-mail';
import { AdminRoot } from './root';
import '../styles/index.css';

initTheme();

function NotFound() {
  useTitle('没有这个页面');
  return (
    <EmptyState icon="circle-help" title="没有这个页面" action={<ButtonLink to="/" icon="arrow-left">回到总览</ButtonLink>}>
      地址可能输错了，或者这个页面已经不存在。
    </EmptyState>
  );
}

// 所有页面都挂在 AdminRoot 之下：未登录时任何地址都显示登录页，登录后原地进入目标页面。
const router = createBrowserRouter([
  {
    element: <AdminRoot />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/login', element: <Navigate to="/" replace /> },
      {
        path: '/tenants/:id',
        element: <TenantLayout />,
        children: [
          { index: true, element: <TenantOverview /> },
          { path: 'mail', element: <TenantMail /> },
          { path: 'access', element: <TenantAccess /> },
          { path: 'records', element: <TenantRecords /> },
        ],
      },
      { path: '/records', element: <RecordsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
], { basename: '/admin' });

const container = document.getElementById('app');
if (!container) throw new Error('管理端根节点不存在');
createRoot(container).render(<StrictMode><RouterProvider router={router} /></StrictMode>);
