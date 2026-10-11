# MailQuota

独立邮件验证码与永久额度服务。按 `MAILQUOTA_DEVELOPMENT_SPEC.md` 实现，已包含独立服务后端、管理 API 与 Web 管理端；客户业务项目的接入改造仍留待后续实施。

Node.js 24 LTS、Express 5、PostgreSQL、Nodemailer；单应用进程，无 Redis 或消息队列。管理端和租户门户使用 React、TypeScript、Vite 和 React Router，生产阶段仍由同一个 Express 进程托管静态产物。依赖精确版本见 `package.json` 和 `pnpm-lock.yaml`。SMTP 凭据只存我方环境配置。

两个前端的源码都在 `frontend/`：一个工程、两个入口，组件和样式共用。`pnpm run build:frontend` 把它们构建到 `public/`，其中 `admin/`、`tenant/` 各有一个入口页，带哈希的资源在 `assets/`。配置并启动服务后，管理员访问 `PUBLIC_ORIGIN/admin/`，租户访问 `PUBLIC_ORIGIN/tenant/`（站点根地址也会跳到这里），无额外前端运行容器。Docker 部署需重新构建镜像以包含新的静态文件。

管理端只有三类页面：总览（需要处理的事、发送趋势、全部租户与额度）、租户页（概览、邮件、接入、记录四栏）和全部发送记录；任何页面按 `Ctrl+K` 可按邮箱查记录、跳到租户或加额度。租户门户有四页：概览（额度、最近发送、趋势）、邮件、发送记录和接入。两个门户的登录会话互相独立。字体与图标随构建产物同源提供，不依赖外网。

## 本地准备

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm run password
pnpm run init
pnpm start
```

`pnpm run password` 不回显输入，自动将 bcrypt 盐哈希写入项目 `.env`，无需复制粘贴，也不保存明文密码。已有其他配置和有效会话密钥会保留；缺少会话密钥时自动生成，缺少 `.env` 时从 `.env.example` 创建。密码至少 8 字符、至多 72 字节。填写管理员名称、访问地址与 SMTP 配置后启动服务；修改密码后重启服务生效（Docker 使用 `docker compose up -d --force-recreate` 重新加载环境变量）。

服务启动时会自动执行幂等 PostgreSQL 结构检查，创建缺失的表、字段和索引；不会删除字段、修改已有字段类型或修改已有业务数据。`pnpm run init` 仍可用于提前执行同一检查，但不是启动前的硬性步骤。新租户通过管理 API 创建，默认停用、额度 0。旧 SQLite 和 JSON 配置不会被导入。

PostgreSQL 不要求由 Docker 启动。直接执行 `docker compose up -d` 时，应用使用 `.env` 中的 `DATABASE_URL`，可以连接宿主机或远程 PostgreSQL。需要由同一份 Compose 启动 PostgreSQL 时，设置 `POSTGRES_PASSWORD`，并执行 `docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d`；覆盖文件会把 `DATABASE_URL` 改为 Compose 内部的 `postgres` 服务地址。也可以通过 `COMPOSE_FILE=docker-compose.yml:docker-compose.postgres.yml`（Windows 使用分号）把这两份文件配置为默认组合。

`PUBLIC_ORIGIN` 支持 HTTP 和 HTTPS。本地测试设置 `PUBLIC_ORIGIN=http://localhost:3000`，启动后访问 `http://localhost:3000/admin/`（管理端）或 `http://localhost:3000/tenant/`（租户门户），无需 HTTPS 或 Nginx。该值须与浏览器实际访问的协议、主机和端口一致，末尾不带斜杠。服务根据配置的协议自动设置会话 Cookie 和页面安全响应头；HTTPS 地址仍校验 HTTPS 请求，可由 Nginx 终止 TLS 并覆盖代理头。

## 文档

- [接口与前端接入契约](docs/API.md)：客户接口、管理会话与 CSRF、所有管理操作、错误码和预览要求。
- [多租户前端接入说明](docs/FRONTEND_INTEGRATION.md)：租户门户、管理员页面和业务 API 的请求字段、权限与页面流程。
- [部署、备份与恢复](docs/OPERATIONS.md)：Docker、Nginx、初始化、上线与回滚。
- [测试与验收报告](docs/VERIFICATION.md)：实际测试、资源占用与未执行项目。

## 验证

```sh
pnpm test
pnpm run test:frontend
pnpm run check:frontend
pnpm run build:frontend
docker build -t mailquota:local .
node test/container-check.js
```

测试会读取 `TEST_DATABASE_URL`，未设置时回退到 `DATABASE_URL`。测试为每个用例创建独立 PostgreSQL schema，结束后只删除自己的 schema，因此开发阶段可以复用同一个 PostgreSQL 数据库，不会清空公共表。测试用户需要有创建和删除 schema 的权限；如果测试被强制中断，残留的 `test_` schema 可手动清理。生产环境仍建议使用独立数据库账号。

`pnpm test` 运行 PostgreSQL 集成测试、HTTP 管理与租户权限测试、额度并发、验证码、邮箱限流和 SMTP 协议测试。`pnpm run test:frontend` 运行管理员和租户接口对接检查。容器检查需要 Docker Desktop 和可用的 PostgreSQL 连接，不会发送真实邮件。

## 一致性约定

`available = quota_total - used_count - reserved_count`。发送前事务占用，SMTP 明确受理后转为已用；明确拒绝才释放，结果不明保留占用供管理员核查。同一租户的同一 UUID 永不自动重新发送，参数改变返回冲突。SMTP 与 PostgreSQL 不是一个事务，不承诺外部发送恰好一次。

验证码只按客户和邮箱识别，有效 5 分钟，六位数字，5 次输错后失效，核销单次；没有 `purpose` 或用户 ID。核销成功后客户本地操作失败也不能回滚远端验证码。

单进程限制是部署约束：禁止启动多个实例共享同一业务环境，禁止 PM2 cluster 或多副本。升级先停旧进程再启动新进程；PostgreSQL 使用 Docker 持久化卷。