# MailQuota

独立邮件验证码与永久额度服务。按 `MAILQUOTA_DEVELOPMENT_SPEC.md` 实现，已包含独立服务后端、管理 API 与 Web 管理端；客户业务项目的接入改造仍留待后续实施。

Node.js 24 LTS、Express 5、SQLite、Nodemailer；单应用进程，无 Redis、消息队列或前端构建。依赖精确版本见 `package.json` 和 `package-lock.json`。SMTP 凭据只存我方环境配置。

管理端使用原生 HTML、CSS、JavaScript，与接口同源。配置并启动服务后访问 `PUBLIC_ORIGIN/admin/`，使用原管理员账号登录，无额外前端服务或构建步骤。Docker 部署需重新构建镜像以包含新增的 `public` 静态文件。

## 本地准备

```sh
npm ci
cp .env.example .env
npm run password
npm run init
npm start
```

`npm run password` 不回显输入，生成 bcrypt 密码哈希和会话密钥。将输出填入 `.env`，再填写管理员名称、域名与 SMTP 配置。密码至少 12 字符、至多 72 字节。没有默认管理员密码、客户密钥或赠送额度。

首次必须显式初始化。正常启动时任何必要文件缺失都会报错；不得通过再次初始化解决数据丢失。`storage/config/customers.json` 为唯一客户配置，`storage/templates` 为邮件模板，`storage/data/mailquota.sqlite` 为账本。新客户通过管理 API 创建，默认停用、额度 0。

应用在生产模式强制 HTTPS 请求，Nginx 终止 TLS 并覆盖代理头。直接访问本机 HTTP 仅健康检查可用。开发联调也建议使用本地 TLS 代理；测试通过依赖注入独立关闭 HTTPS 校验，不提供生产环境跳过认证、扣量、TLS 证书校验或真实试发开关。

## 文档

- [接口与前端接入契约](docs/API.md)：客户接口、管理会话与 CSRF、所有管理操作、错误码和预览要求。
- [部署、备份与恢复](docs/OPERATIONS.md)：Docker、Nginx、初始化、上线与回滚。
- [测试与验收报告](docs/VERIFICATION.md)：实际测试、资源占用与未执行项目。
- [管理端设计、接入与手动验收](docs/FRONTEND.md)：页面结构、接口映射、13项针对性检查和手动测试清单。

## 验证

```sh
npm test
npm run test:frontend
docker build -t mailquota:local .
node test/container-check.js
```

`npm test` 运行全部针对性集成测试，覆盖 SQLite 事务、HTTP 管理安全、前端接口对接和 SMTP 协议模拟。`npm run test:frontend` 仅运行管理端相关的13项检查，不需要浏览器或截图。容器检查需要 Docker Desktop（Linux 容器）及宿主机允许测试 SMTP 监听；约 1～2 分钟，包含 10 次/分钟发送、持久化、备份恢复和崩溃恢复，使用生成的临时 TLS 证书和测试账号。它不会发送真实邮件。

## 一致性约定

`available = quota_total - used_count - reserved_count`。发送前事务占用，SMTP 明确受理后转为已用；明确拒绝才释放，结果不明保留占用供管理员核查。同一客户的同一 UUID 永不自动重新发送，参数改变返回冲突。SMTP 与 SQLite 不是一个事务，不承诺外部发送恰好一次。

验证码只按客户和邮箱识别，有效 5 分钟，六位数字，5 次输错后失效，核销单次；没有 `purpose` 或用户 ID。核销成功后客户本地操作失败也不能回滚远端验证码。

单进程限制是部署约束：禁止启动多个实例共享该持久化目录，禁止 PM2 cluster 或多副本。升级先停旧进程再启动新进程；SQLite 位于本机持久化磁盘。
