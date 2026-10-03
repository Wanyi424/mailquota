import { StrictMode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { createRoot } from 'react-dom/client';
import { App } from './components/app';
import { CustomersPage, CustomerDetailPage } from './pages/customers';
import { RecordsPage } from './pages/records';
import './styles.css';

function RoutesView() {
  return <Routes>
    <Route path="/" element={<Navigate to="/customers" replace />} />
    <Route path="/customers" element={<CustomersPage />} />
    <Route path="/customers/:id" element={<CustomerDetailPage tab="overview" />} />
    <Route path="/customers/:id/template" element={<CustomerDetailPage tab="template" />} />
    <Route path="/customers/:id/records" element={<CustomerDetailPage tab="records" />} />
    <Route path="/records" element={<RecordsPage />} />
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}

function NotFoundPage() {
  return <div className="empty-state"><p>页面不存在</p><a className="button primary" href="/admin/customers">返回客户管理</a></div>;
}

function Root() {
  return <App><RoutesView /></App>;
}

const root = document.getElementById('app');
if (!root) throw new Error('管理端根节点不存在');
createRoot(root).render(<StrictMode><Root /></StrictMode>);
