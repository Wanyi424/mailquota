import { StrictMode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { App, GuardedLink } from './components/app';
import { CustomersPage, CustomerDetailPage } from './pages/customers';
import { RecordsPage } from './pages/records';
import { OverviewPage } from './pages/overview';
import './styles.css';

function RoutesView() {
  return <Routes>
    <Route path="/login" element={<Navigate to="/overview" replace />} />
    <Route path="/" element={<Navigate to="/overview" replace />} />
    <Route path="/overview" element={<OverviewPage />} />
    <Route path="/customers/new" element={<CustomersPage />} />
    <Route path="/customers" element={<CustomersPage />} />
    <Route path="/customers/:id" element={<CustomerDetailPage tab="overview" />} />
    <Route path="/customers/:id/template" element={<CustomerDetailPage tab="template" />} />
    <Route path="/customers/:id/records" element={<CustomerDetailPage tab="records" />} />
    <Route path="/records" element={<RecordsPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}

function NotFoundPage() {
  return <div className="empty-state"><p>页面不存在</p><GuardedLink className="button primary" to="/overview">返回工作台</GuardedLink></div>;
}

function Root() {
  return <App><RoutesView /></App>;
}

const root = document.getElementById('app');
if (!root) throw new Error('管理端根节点不存在');
createRoot(root).render(<StrictMode><Root /></StrictMode>);
