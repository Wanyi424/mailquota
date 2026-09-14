import { createApi } from './api.js';
import { escapeHtml as e, routeInfo } from './helpers.js';
import { $, $$, loading, empty, bindSubmit, field, input, formError, showToast, explainError, confirmDialog, modal } from './ui.js';
import { customersPage, customerPage } from './pages/customers.js';
import { templatesPage } from './pages/templates.js';
import { requestsPage } from './pages/requests.js';

const app = $('#app');
let session = null, epoch = 0, dirty = () => false, currentHash = '', reauth = null, navigating = false;
const api = createApi({ onExpired: () => { if (session) promptLogin(); } });
const navigation = [ ['customers', '客户管理'], ['templates', '邮件模板'], ['requests', '发送记录'], ['pending', '待确认处理'] ];

function loginFields(username = '') {
  return `${formError}${field('管理员账号', input('username', username, 'required maxlength="200" autocomplete="username" placeholder="输入管理员账号"'))}${field('登录密码', '<span class="password-field"><input type="password" name="password" required maxlength="200" autocomplete="current-password" placeholder="输入登录密码"><button type="button" class="button quiet small" data-password aria-label="显示密码" aria-pressed="false">显示</button></span>')}<button class="button primary full-width" type="submit">登录管理端</button>`;
}
function bindPassword(form) {
  $('[data-password]', form).addEventListener('click', event => { const input = $('[name="password"]', form), show = input.type === 'password'; input.type = show ? 'text' : 'password'; event.currentTarget.textContent = show ? '隐藏' : '显示'; event.currentTarget.setAttribute('aria-label', show ? '隐藏密码' : '显示密码'); event.currentTarget.setAttribute('aria-pressed', String(show)); });
}
function renderLogin() {
  epoch++; dirty = () => false; session = null;
  $$('dialog').forEach(dialog => dialog.remove()); reauth = null;
  app.innerHTML = `<div class="login-shell"><aside class="login-story"><span class="brand-word">MailQuota<span>.</span></span><div class="login-copy"><h1>每一封邮件，<br><span>都心中有数。</span></h1><p>集中管理客户、验证码邮件与永久额度。让日常发送清晰，让每次处理有据。</p><div class="login-principles"><div><strong>客户独立</strong><small>凭据与邮件样式分别管理</small></div><div><strong>额度透明</strong><small>已用与占用，清楚区分</small></div></div></div><p class="login-caption">MailQuota · 邮件验证码与额度服务</p></aside><main class="login-main" id="main"><div class="login-box"><div class="login-mobile-brand"><span class="brand-word">MailQuota<span>.</span></span></div><h2>欢迎回来</h2><p>登录后，继续管理你的邮件服务。</p><form class="login-form" data-busy-label="正在登录…">${loginFields()}</form><p class="login-help">仅供服务管理员使用。忘记密码时，请通过服务器配置重设管理员密码。</p></div></main></div>`;
  const form = $('form', app); bindPassword(form);
  bindSubmit(form, async values => { session = await api.login(values.username, values.password); $('[name="password"]', form).value = ''; renderShell(); await renderRoute(location.hash || '#/customers'); });
}
function promptLogin() {
  if (reauth) return;
  reauth = modal('登录已过期', '重新登录后可继续操作，页面中未保存的输入会保留。之前的写入不会自动重试。', `<form class="login-form" data-busy-label="正在登录…">${loginFields(session?.username)}</form>`, { secret: true });
  bindPassword(reauth.form);
  bindSubmit(reauth.form, async values => {
    session = await api.login(values.username, values.password); reauth.close(); reauth = null;
    $('.account-name', app).textContent = session.username; showToast('已重新登录，请确认数据后继续操作。');
  });
}
function renderShell() {
  app.innerHTML = `<div class="app-shell"><button class="nav-overlay" aria-label="收起导航"></button><aside class="sidebar"><a class="brand" href="#/customers"><span class="brand-word">MailQuota<span>.</span></span><span class="brand-sub">邮件服务管理</span></a><div class="nav-label">工作空间</div><nav class="nav" aria-label="主导航">${navigation.map(([path, label]) => `<a href="#/${path}" data-nav="${path}"><span>${label}</span></a>`).join('')}</nav><div class="sidebar-bottom"><div class="sidebar-note">永久额度 · 按客户累计<br>独立的邮件验证码服务</div></div></aside><header class="topbar"><div class="breadcrumb"><button class="button quiet small mobile-menu" aria-label="展开导航" aria-expanded="false">菜单</button><span>管理控制台</span><span aria-hidden="true">/</span><strong data-breadcrumb>客户管理</strong></div><div class="account"><span class="avatar" aria-hidden="true">${e([...session.username][0]?.toUpperCase() || 'A')}</span><span class="account-name">${e(session.username)}</span><button class="button quiet small" data-logout>退出</button></div></header><main id="main" class="content" tabindex="-1"></main></div>`;
  function closeMenu() { $('.app-shell', app).classList.remove('nav-open'); $('.mobile-menu', app).setAttribute('aria-expanded', 'false'); }
  $('.mobile-menu', app).addEventListener('click', event => { const open = $('.app-shell', app).classList.toggle('nav-open'); event.currentTarget.setAttribute('aria-expanded', String(open)); });
  $('.nav-overlay', app).addEventListener('click', closeMenu);
  $('.nav', app).addEventListener('click', closeMenu);
  $('[data-logout]', app).addEventListener('click', async event => {
    const button = event.currentTarget;
    if (dirty() && !await confirmDialog('放弃修改并退出？', '当前未保存的内容将丢失。', '退出登录')) return;
    button.disabled = true;
    try { await api.logout(); renderLogin(); showToast('已退出登录。'); }
    catch (error) { showToast(explainError(error), 'error'); }
    finally { button.disabled = false; }
  });
}

async function navigate(hash, { replace = false, force = false } = {}) {
  if (navigating) return false;
  navigating = true;
  try {
    if (!force && dirty() && !await confirmDialog('离开并放弃未保存的修改？', '当前输入尚未保存，离开后将丢失。', '放弃修改')) return false;
    if (replace) history.replaceState(null, '', hash); else if (location.hash !== hash) history.pushState(null, '', hash);
  } finally { navigating = false; }
  await renderRoute(hash); return true;
}

async function renderRoute(hash) {
  if (!session) return;
  const localEpoch = ++epoch; currentHash = hash; dirty = () => false;
  const root = $('#main', app); if (!root) return;
  root.innerHTML = loading(); root.setAttribute('aria-busy', 'true');
  let info;
  try { info = routeInfo(hash); } catch { root.innerHTML = empty('页面地址不正确', '请从侧边导航重新进入。'); root.removeAttribute('aria-busy'); return; }
  const [page = 'customers', id] = info.parts;
  $$('[data-nav]', app).forEach(node => { const selected = node.dataset.nav === page; node.classList.toggle('active', selected); if (selected) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
  $('[data-breadcrumb]', app).textContent = navigation.find(([key]) => key === page)?.[1] || '管理控制台';
  document.title = `${$('[data-breadcrumb]', app).textContent} · MailQuota`;
  let allCustomersPromise;
  const ctx = {
    root, api, active: () => epoch === localEpoch && Boolean(session),
    setDirty: fn => { if (epoch === localEpoch) dirty = fn; },
    navigate: (target, options) => navigate(target, options),
    refresh: options => epoch === localEpoch ? navigate(currentHash, { replace: true, ...options }) : Promise.resolve(false),
    allCustomers: () => allCustomersPromise ||= (async () => {
      const first = await api.customers(1, 100), items = [...first.items];
      for (let pageNumber = 2; pageNumber <= Math.ceil(first.total / 100); pageNumber++) items.push(...(await api.customers(pageNumber, 100)).items);
      return items;
    })(),
  };
  try {
    await api.session(); if (!ctx.active()) return;
    if (page === 'customers' && !id) await customersPage(ctx);
    else if (page === 'customers' && id) await customerPage(ctx, id);
    else if (page === 'templates') await templatesPage(ctx, id, info.query.get('tab'));
    else if (page === 'requests' || page === 'pending') await requestsPage(ctx, page === 'pending', info.query);
    else root.innerHTML = empty('页面不存在', '请使用左侧导航进入客户、模板或发送记录。', '<a class="button primary" href="#/customers">返回客户管理</a>');
    if (ctx.active()) $('h1', root)?.focus({ preventScroll: true });
  } catch (error) {
    if (!ctx.active()) return;
    root.innerHTML = empty(error.code === 'CUSTOMER_NOT_FOUND' ? '客户不存在' : '暂时无法读取页面', explainError(error), '<button class="button secondary" data-retry-page>重新加载</button>');
    $('[data-retry-page]', root).addEventListener('click', () => { void navigate(currentHash, { replace: true }); });
  } finally { if (ctx.active()) root.removeAttribute('aria-busy'); }
}

document.addEventListener('click', event => {
  if (event.target.closest('.skip-link')) { event.preventDefault(); $('#main')?.focus(); return; }
  const link = event.target.closest('a[href^="#/"]');
  if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault(); void navigate(link.getAttribute('href'));
});
window.addEventListener('hashchange', () => {
  if (!session || location.hash === currentHash) return;
  const target = location.hash || '#/customers';
  // Restore the displayed route while asking about unsaved input (also covers browser Back).
  history.replaceState(null, '', currentHash || '#/customers');
  void navigate(target, { replace: true });
});
window.addEventListener('beforeunload', event => {
  if (dirty() || $$('dialog form').some(form => form.dataset.busy === 'true' || form.dataset.changed === 'true') || $('.secret-value')) { event.preventDefault(); event.returnValue = ''; }
});
document.addEventListener('input', event => { const form = event.target.closest('dialog form'); if (form) form.dataset.changed = 'true'; });

async function start() {
  try { session = await api.session(); renderShell(); await renderRoute(location.hash || '#/customers'); }
  catch (error) {
    if (error.code === 'ADMIN_AUTH_REQUIRED') { renderLogin(); return; }
    app.innerHTML = `<main class="boot">${empty('暂时无法连接管理服务', explainError(error), '<button class="button primary" data-start-retry>重新连接</button>')}</main>`;
    $('[data-start-retry]', app).addEventListener('click', () => { void start(); });
  }
}
void start();
