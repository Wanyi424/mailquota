import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, fail, parse } from './errors.js';
import { sendSchema, verifySchema, requestId, customerId, loginName, pageFields, positive, rowId } from './validation.js';
import { requestData, sendResponse } from './service.js';
import { adminRequestQuery, tenantRequestQuery, dailyStats, listRequests } from './reports.js';
const ok=(res,code,data,message='操作成功')=>res.json({success:true,code,message,...(data===undefined?{}:{data})});
const statDays = positive.max(90).default(14);
// pg 把 BIGINT 当字符串返回，这里统一换回数字。
const adjustment = r => ({ id: Number(r.id), before_total: Number(r.before_total), after_total: Number(r.after_total), delta: Number(r.delta), reason: r.reason, actor_id: r.actor_id, request_id: r.request_id, created_at: r.created_at });
export function createApp({service,config,admin,sender='',secure=new URL(admin.origin).protocol==='https:',trustProxy='loopback',logger=()=>{}}){
 const app=express(); app.disable('x-powered-by');app.set('trust proxy',trustProxy);
 // 邮件预览要能显示模板里的外链图片；HTTP 部署时不能让浏览器把页面资源升级成 HTTPS。
 app.use(helmet({strictTransportSecurity:secure?undefined:false,contentSecurityPolicy:{directives:{imgSrc:["'self'",'https:','data:'],frameSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:secure?[]:null}}}));
 app.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});app.use(express.json({limit:'2mb'}));
 app.get('/health/live',(q,s)=>s.json({status:'live'}));app.get('/health/ready',async(q,s,n)=>{try{await config.check();s.json({status:'ready'});}catch(e){n(e);}});
 app.use(['/api','/admin','/tenant'],(req,res,next)=>secure&&!req.secure?next(new AppError(400,'HTTPS_REQUIRED','请通过 HTTPS 访问')):next());
 app.use('/api/v1',async(req,res,next)=>{try{req.tenant=await service.auth(req.get('X-Customer-Id'),req.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1]);next();}catch(e){next(e);}});
 app.post('/api/v1/verification-codes/send',async(req,res,next)=>{try{sendResponse(res,await service.send(req.tenant,parse(sendSchema,req.body)));}catch(e){next(e);}});
 app.get('/api/v1/verification-codes/requests/:requestId',async(req,res,next)=>{try{const r=await service.request(req.tenant.id,parse(requestId,req.params.requestId));if(!r)fail(404,'REQUEST_NOT_FOUND','发送记录不存在');ok(res,'REQUEST_FOUND',requestData(r));}catch(e){next(e);}});
 app.post('/api/v1/verification-codes/verify',async(req,res,next)=>{try{await service.verify(req.tenant,parse(verifySchema,req.body));ok(res,'VERIFIED',undefined,'验证成功');}catch(e){next(e);}});
 const store=new session.MemoryStore(), adminSession=session({name:'mailquota.admin.sid',secret:admin.sessionSecret,store,resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure,sameSite:'strict',maxAge:8*3600000}}), tenantSession=session({name:'mailquota.tenant.sid',secret:admin.sessionSecret+'tenant',store:new session.MemoryStore(),resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure,sameSite:'strict',maxAge:8*3600000}});
 const origin=req=>req.get('Origin')===admin.origin;
 const loginFailures=new Map();
 const reserveLoginAttempt=(key, now)=>{let state=loginFailures.get(key);if(!state||state.expires<=now){state={count:0,expires:now+900000};loginFailures.set(key,state);}if(state.count>=10)fail(429,'LOGIN_RATE_LIMIT','登录尝试过多，请稍后重试',{retry_after_seconds:Math.max(1,Math.ceil((state.expires-now)/1000))});state.count++;return state;};
 const clearLoginAttempts=key=>loginFailures.delete(key);
 const loginCleanup=setInterval(()=>{const now=service.now();for(const [key,state] of loginFailures)if(state.expires<=now)loginFailures.delete(key);},60000); loginCleanup.unref();
 // 两个门户登录后拿到的身份。sender 是实际发信地址，只用来让邮件预览更接近真实收件效果。
 const identity=req=>({username:req.session.admin,csrf_token:req.session.csrf,sender});
 const tenantIdentity=(req,t)=>({customer_id:t.customer_id,name:t.name,login_name:t.login_name,csrf_token:req.session.csrf,sender});
 app.use('/admin',adminSession);app.post('/admin/api/login',async(req,res,next)=>{try{if(!origin(req))fail(403,'CSRF_INVALID','请求来源无效');const b=parse(z.object({username:z.string(),password:z.string()}).strict(),req.body),key=`admin:${req.ip}`;reserveLoginAttempt(key,service.now());if(b.username!==admin.username||!(await bcrypt.compare(b.password,admin.passwordHash)))fail(401,'ADMIN_AUTH_INVALID','账号或密码错误');clearLoginAttempts(key);await new Promise((r,j)=>req.session.regenerate(e=>e?j(e):r()));req.session.admin=admin.username;req.session.csrf=randomBytes(32).toString('base64url');ok(res,'LOGGED_IN',identity(req));}catch(e){next(e);}});
 app.use('/admin/api',(req,res,next)=>{if(!req.session.admin)return next(new AppError(401,'ADMIN_AUTH_REQUIRED','请先登录管理员账号'));if(!['GET','HEAD'].includes(req.method)){const a=Buffer.from(req.get('X-CSRF-Token')||''),b=Buffer.from(req.session.csrf||'');if(!origin(req)||a.length!==b.length||!timingSafeEqual(a,b))return next(new AppError(403,'CSRF_INVALID','安全校验失败'));}next();});
 app.get('/admin/api/session',(req,res)=>ok(res,'SESSION_FOUND',identity(req)));app.post('/admin/api/logout',(req,res,next)=>req.session.destroy(e=>e?next(e):ok(res,'LOGGED_OUT')));
 app.get('/admin/api/tenants',async(req,res,next)=>{try{ok(res,'TENANTS_FOUND',{items:await config.list()});}catch(e){next(e);}});
 app.post('/admin/api/tenants',async(req,res,next)=>{try{const c=await config.create(req.body,req.session.admin);ok(res.status(201),'TENANT_CREATED',{...config.public(c),api_key:c.api_key});}catch(e){next(e);}});
 app.get('/admin/api/tenants/:id',async(req,res,next)=>{try{ok(res,'TENANT_FOUND',config.public(await config.requireCustomer(req.params.id)));}catch(e){next(e);}});
 app.patch('/admin/api/tenants/:id',async(req,res,next)=>{try{ok(res,'TENANT_UPDATED',config.public(await config.update(req.params.id,req.body)));}catch(e){next(e);}});
 app.post('/admin/api/tenants/:id/api-key',async(req,res,next)=>{try{const c=await config.resetKey(req.params.id,req.session.admin);ok(res,'KEY_RESET',{...config.public(c),api_key:c.api_key});}catch(e){next(e);}});
 app.post('/admin/api/tenants/:id/password',async(req,res,next)=>{try{const b=parse(z.object({password:z.string().min(8).max(72)}).strict(),req.body);await config.resetPassword(req.params.id,b.password,req.session.admin);ok(res,'PASSWORD_RESET');}catch(e){next(e);}});
 app.post('/admin/api/tenants/:id/quota',async(req,res,next)=>{try{const b=parse(z.object({delta:z.coerce.number().int().refine(v=>v!==0),reason:z.string().max(2000).optional(),request_id:z.uuid().default(randomUUID())}).strict(),req.body);const c=await config.requireCustomer(req.params.id);const r=await service.db.transaction(async tx=>{const old=(await tx.query('SELECT * FROM tenant_quota_adjustments WHERE tenant_id=$1 AND request_id=$2',[c.id,b.request_id])).rows[0];if(old){if(Number(old.delta)!==b.delta)fail(409,'REQUEST_CONFLICT','额度请求编号已用于其他调整');return old;}const q=(await tx.query('SELECT * FROM tenant_quotas WHERE tenant_id=$1 FOR UPDATE',[c.id])).rows[0];const after=Number(q.quota_total)+b.delta;if(after<Number(q.used_count)+Number(q.reserved_count))fail(409,'QUOTA_TOO_LOW','减少后额度不能小于已使用和预占额度');await tx.query('UPDATE tenant_quotas SET quota_total=$1,updated_at=now() WHERE tenant_id=$2',[after,c.id]);return (await tx.query('INSERT INTO tenant_quota_adjustments(tenant_id,before_total,after_total,delta,reason,actor_type,actor_id,request_id) VALUES($1,$2,$3,$4,$5,\'admin\',$6,$7) RETURNING *',[c.id,q.quota_total,after,b.delta,b.reason||null,req.session.admin,b.request_id])).rows[0];});ok(res,'QUOTA_UPDATED',r);}catch(e){next(e);}});
 // 某个租户的调额历史，新的在前。
 app.get('/admin/api/tenants/:id/quota-adjustments', async (req, res) => {
   const q = parse(z.object(pageFields).strict(), req.query), t = await config.requireCustomer(req.params.id);
   const total = (await service.db.query('SELECT count(*)::int AS n FROM tenant_quota_adjustments WHERE tenant_id=$1', [t.id])).rows[0].n;
   const { rows } = await service.db.query('SELECT * FROM tenant_quota_adjustments WHERE tenant_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3', [t.id, q.page_size, (q.page - 1) * q.page_size]);
   ok(res, 'QUOTA_ADJUSTMENTS_FOUND', { total, page: q.page, page_size: q.page_size, items: rows.map(adjustment) });
 });
 app.get('/admin/api/requests', async (req, res) => {
   ok(res, 'REQUESTS_FOUND', await listRequests(service.db, parse(adminRequestQuery, req.query), { columns: 'r.*, t.customer_id, t.name AS tenant_name' }));
 });
 // 详情带上当时实际发出的内容；人工结算后返回同一形态，管理端不用再读一次。
 const requestDetail = async id => {
   const r = (await service.db.query('SELECT r.*, t.customer_id, t.name AS tenant_name, c.from_email, c.from_name, c.reply_to, c.subject, c.html_body, c.text_body, c.config_version FROM send_requests r JOIN tenants t ON t.id=r.tenant_id JOIN send_request_contents c ON c.send_request_id=r.id WHERE r.id=$1', [id])).rows[0];
   if (!r) fail(404, 'REQUEST_NOT_FOUND', '发送记录不存在');
   return r;
 };
 app.get('/admin/api/requests/:id', async (req, res) => ok(res, 'REQUEST_FOUND', await requestDetail(parse(rowId, req.params.id))));
 app.post('/admin/api/requests/:id/resolve', async (req, res) => {
   const id = parse(rowId, req.params.id), b = parse(z.object({ status: z.enum(['accepted', 'failed']), note: z.string().trim().max(2000).optional() }).strict(), req.body);
   await service.settle(id, 'unknown', { status: b.status }, { id: req.session.admin, note: b.note });
   ok(res, 'REQUEST_RESOLVED', await requestDetail(id));
 });
 app.get('/admin/api/quota-details',async(req,res,next)=>{try{const {rows}=await service.db.query('SELECT * FROM quota_details ORDER BY occurred_at DESC LIMIT 500');ok(res,'QUOTA_DETAILS_FOUND',{items:rows});}catch(e){next(e);}});
 // 按天的发送量。带 customer_id 时只统计这个租户；unresolved 始终是全部结果不明的记录数，不受时间窗限制。
 app.get('/admin/api/stats', async (req, res) => {
   const q = parse(z.object({ days: statDays, customer_id: customerId.optional() }).strict(), req.query);
   const tenant = q.customer_id ? await config.requireCustomer(q.customer_id) : null;
   const unresolved = (await service.db.query("SELECT count(*)::int AS n FROM send_requests WHERE status='unknown'")).rows[0].n;
   ok(res, 'STATS_FOUND', { ...await dailyStats(service.db, service.now(), q.days, tenant?.id), unresolved });
 });
 app.use('/tenant',tenantSession);app.post('/tenant/api/login',async(req,res,next)=>{try{if(!origin(req))fail(403,'CSRF_INVALID','请求来源无效');const b=parse(z.object({login_name:loginName,password:z.string()}).strict(),req.body),key=`tenant:${req.ip}:${b.login_name.toLowerCase()}`;reserveLoginAttempt(key,service.now());const r=(await service.db.query('SELECT a.*,t.enabled,t.customer_id,t.name FROM tenant_accounts a JOIN tenants t ON t.id=a.tenant_id WHERE a.login_name=$1',[b.login_name])).rows[0];if(!r||!r.enabled||!(await bcrypt.compare(b.password,r.password_hash)))fail(401,'TENANT_AUTH_INVALID','账号或密码错误');clearLoginAttempts(key);req.session.tenant_id=r.tenant_id;req.session.csrf=randomBytes(32).toString('base64url');await service.db.query('UPDATE tenant_accounts SET last_login_at=now() WHERE tenant_id=$1',[r.tenant_id]);ok(res,'LOGGED_IN',tenantIdentity(req,r));}catch(e){next(e);}});
 app.use('/tenant/api',async(req,res,next)=>{if(!req.session.tenant_id)return next(new AppError(401,'TENANT_AUTH_REQUIRED','请先登录租户账号'));if(!['GET','HEAD'].includes(req.method)){const a=Buffer.from(req.get('X-CSRF-Token')||''),b=Buffer.from(req.session.csrf||'');if(!origin(req)||a.length!==b.length||!timingSafeEqual(a,b))return next(new AppError(403,'CSRF_INVALID','安全校验失败'));}try{req.tenant=await config.get(req.session.tenant_id);if(!req.tenant)return next(new AppError(401,'TENANT_AUTH_REQUIRED','请先登录租户账号'));next();}catch(e){next(e);}});
 app.get('/tenant/api/session',(req,res)=>ok(res,'SESSION_FOUND',tenantIdentity(req,req.tenant)));app.post('/tenant/api/logout',(req,res,next)=>req.session.destroy(e=>e?next(e):ok(res,'LOGGED_OUT')));app.get('/tenant/api/me',(req,res)=>ok(res,'TENANT_FOUND',config.public(req.tenant)));app.get('/tenant/api/quota',(req,res)=>ok(res,'QUOTA_FOUND',{quota_total:Number(req.tenant.quota_total),used_count:Number(req.tenant.used_count),reserved_count:Number(req.tenant.reserved_count),available_count:Number(req.tenant.quota_total)-Number(req.tenant.used_count)-Number(req.tenant.reserved_count)}));app.get('/tenant/api/config',(req,res)=>ok(res,'CONFIG_FOUND',{from_name:req.tenant.from_name,subject:req.tenant.subject,html_template:req.tenant.html_template,text_template:req.tenant.text_template,reply_to:req.tenant.reply_to,version:req.tenant.version}));
 app.patch('/tenant/api/config',async(req,res,next)=>{try{if(!origin(req))fail(403,'CSRF_INVALID','请求来源无效');const b=parse(z.object({version:z.coerce.number().int().positive(),from_name:z.string().trim().min(1).max(100).optional(),subject:z.string().trim().min(1).max(200).optional(),html_template:z.string().optional(),text_template:z.string().optional(),reply_to:z.string().optional()}).strict(),req.body);ok(res,'CONFIG_UPDATED',config.public(await config.update(req.tenant.customer_id,b)));}catch(e){next(e);}});
 // 租户只能看到自己的记录，且只有这几列：不含正文、验证码、上报 IP 和人工处理信息。
 app.get('/tenant/api/requests', async (req, res) => {
   const columns = "r.request_id, r.email, r.status, r.created_at, r.updated_at, r.smtp_message_id, r.smtp_error_code, r.smtp_error_detail, r.created_at+interval '5 minutes' AS code_expires_at, r.created_at+interval '1 minute' AS resend_available_at";
   ok(res, 'REQUESTS_FOUND', await listRequests(service.db, parse(tenantRequestQuery, req.query), { tenantId: req.tenant.id, columns }));
 });
 app.get('/tenant/api/stats', async (req, res) => {
   const { days } = parse(z.object({ days: statDays }).strict(), req.query);
   const stats = await dailyStats(service.db, service.now(), days, req.tenant.id);
   ok(res, 'STATS_FOUND', { days: stats.days, series: stats.series, week: stats.week[req.tenant.customer_id] || 0 });
 });
 // 只公开打包好的两个前端入口和带内容哈希的资源，配置与数据目录从不作为静态根。
 const pub = fileURLToPath(new URL('../public/', import.meta.url));
 app.get('/', (req, res) => res.redirect('/tenant/'));
 // assets/ 下的文件名带内容哈希，可以长期缓存；入口页与接口仍然 no-store。
 app.use('/assets', express.static(join(pub, 'assets'), { index: false, dotfiles: 'deny', redirect: false, setHeaders: res => res.set('Cache-Control', 'public, max-age=31536000, immutable') }));
 for (const portal of ['admin', 'tenant']) {
   const page = (req, res) => res.sendFile(join(pub, portal, 'index.html'));
   app.get(`/${portal}`, (req, res, next) => req.path.endsWith('/') ? next() : res.redirect(`/${portal}/`));
   app.get(`/${portal}/`, page);
   // 前端路由的页面地址都回到同一个入口；接口路径保持 JSON 边界。
   app.get(new RegExp(`^/${portal}/(?!api(?:/|$)|assets(?:/|$)).+$`), page);
 }
 app.use((req,res)=>res.status(404).json({success:false,code:'NOT_FOUND',message:'接口不存在'}));app.use((err,req,res,next)=>{if(res.headersSent)return next(err);logger({event:'service_error',error:err.message});const e=err instanceof AppError?err:new AppError(503,'SERVICE_UNAVAILABLE','服务暂不可用，请稍后重试');if(e.status===429&&e.data?.retry_after_seconds)res.set('Retry-After',String(e.data.retry_after_seconds));res.status(e.status).json({success:false,code:e.code,message:e.message,...(e.data?{data:e.data}: {})});});
 app.locals.dispose=()=>{clearInterval(loginCleanup);};return app;
}
