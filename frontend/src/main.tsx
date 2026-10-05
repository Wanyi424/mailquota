import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { useTitle } from './app/admin';
import { Root } from './app/root';
import { initTheme } from './lib/theme';
import { CustomerLayout, CustomerOverview, CustomerRecords } from './pages/customer';
import { CustomerAccess } from './pages/customer-access';
import { CustomerEmail } from './pages/customer-email';
import { HomePage } from './pages/home';
import { RecordsPage } from './pages/records';
import { ButtonLink, EmptyState } from './ui/controls';
import './styles/index.css';

initTheme();

function NotFound() {
  useTitle('没有这个页面');
  return (
    <EmptyState icon="circle-help" title="没有这个页面" action={<ButtonLink to="/" icon="arrow-left">回到总览</ButtonLink>}>
      地址可能输错了，或者这个页面已经不存在。
    </EmptyState>
  );
}

// 所有页面都挂在 Root 之下：未登录时 Root 在任何地址都显示登录页，登录后原地进入目标页面。
const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/login', element: <Navigate to="/" replace /> },
      {
        path: '/customers/:id',
        element: <CustomerLayout />,
        children: [
          { index: true, element: <CustomerOverview /> },
          { path: 'email', element: <CustomerEmail /> },
          { path: 'access', element: <CustomerAccess /> },
          { path: 'records', element: <CustomerRecords /> },
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
