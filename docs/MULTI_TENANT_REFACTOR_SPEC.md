# MailQuota 多租户重构设计与开发交接规范

版本：1.2（讨论稿）  
日期：2026-10-10  
项目：MailQuota

本文是 MailQuota 从“单管理员、多客户”升级为“多租户服务”的统一开发依据。开发、测试、部署和产品讨论都应以本文为准。本文明确区分了已经确认的规则和仍需产品确认的事项。

---

## 1. 已确认的目标

系统升级后应满足：

1. 一个系统管理员统一管理多个租户。
2. 每个租户拥有一个独立登录账号。
3. 租户只能访问和管理自己的数据。
4. 租户可以查看本租户的额度和发送明细。
5. 租户可以管理自己的邮件展示配置：
   - 发件昵称；
   - 邮件标题；
   - HTML 模板；
   - 纯文本模板；
   - 回复地址。
6. 租户不能修改：
   - 总额度；
   - 已用额度；
   - 启用状态；
   - API Key；
   - 租户编号；
   - 其他租户数据。
7. 系统管理员可以管理租户、额度、API Key、租户账号和租户配置。
8. 保留邮件发送、验证码核验、额度统计、限流和结果不明处理能力。
9. 租户之间的客户配置、发送记录、验证码、限流数据和额度数据必须隔离。
10. 当前规模为几十到几百个租户，最多约千级。
11. 所有服务部署在同一台服务器，不考虑多应用实例、负载均衡和高可用集群。
12. 当前不实现一个租户下多个账号、角色权限或组织层级。

旧的 SQLite 数据和 customers.json 不需要保留，也不需要兼容迁移。此次可以直接建立全新的 PostgreSQL 数据库。

---

## 2. 技术选型

### 2.1 数据库

使用 PostgreSQL。

选择原因：

- 支持完整的外键、唯一约束、检查约束和事务；
- 适合额度预占、发送结算和验证码核销等并发场景；
- 适合明确表达租户归属；
- 使用原生 SQL 即可，不引入 ORM；
- 便于后续增加审计字段和查询能力。

不使用 Redis。当前请求量不足以证明 Redis 有必要，增加 Redis 会增加常驻服务、部署、备份、故障排查和一致性维护成本。

### 2.2 Node.js 数据库访问

使用 pg 连接 PostgreSQL，直接编写参数化 SQL。

不引入 Prisma、TypeORM 等 ORM，原因是：

- 当前表结构和事务边界比较明确；
- 原生 SQL 更容易审查租户过滤条件；
- 减少运行时依赖和内存占用；
- 避免 ORM 隐藏事务和锁行为。

数据库连接池应设置明确上限，建议最大连接数为 2～5。单个 Node.js 应用只运行一个进程。

### 2.3 邮件发送

项目继续使用 Nodemailer 的 SMTP 能力。

Nodemailer 是 Node.js 侧的 SMTP 客户端库，不是实际邮件服务商。实际服务商由环境变量中的 SMTP 主机、账号和密码决定，例如阿里云 SMTP。

发送关系：

~~~text
MailQuota
  -> Nodemailer 组装邮件并发送 SMTP 命令
  -> SMTP_HOST 指向的邮件服务商
  -> 服务商接收邮件并继续投递
~~~

SMTP 接受只表示服务商接收了提交请求，不代表邮件已经进入收件箱，也不代表用户已经打开邮件。

---

## 3. 命名规则

### 3.1 租户主表中的两个 ID

tenants 同时保留内部主键和业务标识：

| 字段 | 含义 | 生成方式 | 是否对外 |
|---|---|---|---|
| id | 数据库内部主键 | 服务端生成 UUID | 不直接暴露 |
| customer_id | 对外业务客户标识 | 创建租户时由管理员填写 | 对外使用 |

示例：

~~~text
tenants.id          = 8c5f...UUID
tenants.customer_id = customer_a
~~~

customer_id 必须唯一、创建后不可修改，格式建议限制为 1～64 位字母、数字、下划线或短横线。

### 3.2 业务表外键

所有租户业务表统一使用：

~~~text
tenant_id UUID REFERENCES tenants(id)
~~~

业务表不重复保存 customer_id，避免业务编号和内部 UUID 发生不一致。

### 3.3 客户 API 请求头

客户 API 使用：

~~~http
X-Customer-Id: customer_a
Authorization: Bearer <tenant_api_key>
~~~

X-Customer-Id 对应 tenants.customer_id，不是内部 UUID。

服务端必须同时校验：

1. X-Customer-Id 对应的租户存在；
2. API Key 属于该租户；
3. 租户处于启用状态。

ID 和 API Key 不匹配时统一返回 401 AUTH_INVALID，不暴露租户是否存在。

---

## 4. 数据库表设计

所有表和字段都应在 PostgreSQL SQL 文件中使用 COMMENT ON TABLE 和 COMMENT ON COLUMN 添加中文注释。

### 4.1 tenants：租户基本信息

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PRIMARY KEY | 内部租户主键，服务端生成 |
| customer_id | VARCHAR(64) UNIQUE NOT NULL | 对外业务客户标识 |
| name | VARCHAR(200) NOT NULL | 租户名称 |
| enabled | BOOLEAN NOT NULL | 是否允许调用客户 API |
| created_at | TIMESTAMPTZ NOT NULL | 创建时间 |
| updated_at | TIMESTAMPTZ NOT NULL | 最后更新时间 |

租户不提供删除功能，停用后保留历史数据。

### 4.2 tenant_accounts：租户登录账号

当前一个租户只有一个账号，因此使用 tenant_accounts，不使用暗示多用户的 tenant_users。

| 字段 | 类型 | 说明 |
|---|---|---|
| tenant_id | UUID PRIMARY KEY REFERENCES tenants(id) | 所属租户 |
| login_name | VARCHAR(200) UNIQUE NOT NULL | 登录账号 |
| password_hash | TEXT NOT NULL | 登录密码哈希 |
| last_login_at | TIMESTAMPTZ | 最近登录时间 |
| created_at | TIMESTAMPTZ NOT NULL | 创建时间 |
| updated_at | TIMESTAMPTZ NOT NULL | 最后更新时间 |

系统管理员负责创建账号和重置租户密码。

### 4.3 tenant_api_keys：租户 API Key

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID PRIMARY KEY | 单把 API Key 的内部编号 |
| tenant_id | UUID NOT NULL REFERENCES tenants(id) | 所属租户 |
| key_hash | CHAR(64) UNIQUE NOT NULL | API Key 哈希值 |
| status | VARCHAR(16) NOT NULL | active 或 revoked |
| created_at | TIMESTAMPTZ NOT NULL | 创建时间 |
| created_by_type | VARCHAR(32) NOT NULL | 创建者类型 |
| created_by_id | VARCHAR(200) NOT NULL | 创建者 ID |
| revoked_at | TIMESTAMPTZ | 吊销时间 |
| revoked_by_type | VARCHAR(32) | 吊销者类型 |
| revoked_by_id | VARCHAR(200) | 吊销者 ID |
| revoke_reason | TEXT | 吊销原因，可为空 |

key_hash 的中文含义是“API Key 哈希值”，只用于认证，不可反推出原始 API Key。

当前每个租户只允许一把 active Key。重置时在同一事务中吊销旧 Key 并插入新 Key。旧 Key 记录保留，便于审计。创建者和吊销者统一由类型与 ID 关联，不保存名称快照。

完整 API Key 只在创建或重置时返回一次。当前只有系统管理员可以创建、重置和吊销 Key；未来允许租户开发团队操作时，再开放对应权限。
### 4.4 tenant_mail_configs：租户邮件配置

| 字段 | 类型 | 说明 |
|---|---|---|
| tenant_id | UUID PRIMARY KEY REFERENCES tenants(id) | 所属租户 |
| from_name | VARCHAR(100) NOT NULL | 发件昵称 |
| subject | VARCHAR(200) NOT NULL | 邮件标题 |
| html_template | TEXT NOT NULL | HTML 邮件模板 |
| text_template | TEXT NOT NULL | 纯文本邮件模板 |
| reply_to | VARCHAR(254) | 回复地址，可为空 |
| version | BIGINT NOT NULL | 配置版本，用于并发编辑冲突 |
| updated_at | TIMESTAMPTZ NOT NULL | 最后更新时间 |

模板只允许：

- {{code}}
- {{expires_minutes}}

模板不允许脚本、表达式、文件引用和服务端代码执行。

租户可以修改邮件展示配置。系统管理员可以查看和修改全部租户配置。

### 4.5 tenant_quotas：额度计数

| 字段 | 类型 | 说明 |
|---|---|---|
| tenant_id | UUID PRIMARY KEY REFERENCES tenants(id) | 所属租户 |
| quota_total | BIGINT NOT NULL CHECK (quota_total >= 0) | 总额度 |
| used_count | BIGINT NOT NULL CHECK (used_count >= 0) | 已确认使用数量 |
| reserved_count | BIGINT NOT NULL CHECK (reserved_count >= 0) | 发送中或结果不明的预占数量 |
| updated_at | TIMESTAMPTZ NOT NULL | 最后更新时间 |

可用额度：

~~~text
available = quota_total - used_count - reserved_count
~~~

只有系统管理员可以增加或减少总额度。客户端和租户账号不能修改额度计数。

### 4.6 tenant_quota_adjustments：总额度调整明细

该表只记录管理员对 quota_total 的调整，不记录每一封邮件的消费流水。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGSERIAL PRIMARY KEY | 调整记录编号 |
| tenant_id | UUID NOT NULL REFERENCES tenants(id) | 所属租户 |
| before_total | BIGINT NOT NULL | 调整前总额度 |
| after_total | BIGINT NOT NULL | 调整后总额度 |
| delta | BIGINT NOT NULL | 本次变化量，正数表示增加，负数表示减少 |
| reason | TEXT | 调整原因，可为空 |
| actor_type | VARCHAR(32) NOT NULL | 操作者类型 |
| actor_id | VARCHAR(200) NOT NULL | 操作者 ID |
| request_id | UUID NOT NULL | 调整操作幂等编号 |
| created_at | TIMESTAMPTZ NOT NULL | 调整时间 |

建议建立：

~~~text
UNIQUE (tenant_id, request_id)
~~~

额度调整事务必须锁定 tenant_quotas，检查新总额度不低于 used_count + reserved_count，然后同时写入本表和更新 tenant_quotas。delta 为正数表示增加额度，delta 为负数表示减少额度，不再保存单独的操作类型字段。

发送成功时只更新 tenant_quotas.used_count，不写入 tenant_quota_adjustments。发送记录已经说明了哪一次邮件被接受，额度调整表只负责说明总额度为何发生变化。

系统管理员当前同时可以增加和减少额度。减少额度时必须满足：

~~~text
after_total >= used_count + reserved_count
~~~

当前系统管理员只有一个环境变量账号，因此 actor_id 可以保存该账号标识；未来如果建立管理员表或开放租户账号操作，再按 actor_type 解释 actor_id。
### 4.7 send_requests：发送记录

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BIGSERIAL PRIMARY KEY | 内部发送记录编号 |
| tenant_id | UUID NOT NULL REFERENCES tenants(id) | 所属租户 |
| request_id | UUID NOT NULL | 客户侧幂等请求编号 |
| email | VARCHAR(254) NOT NULL | 收件邮箱 |
| reported_client_ip | INET | 租户上报的客户端 IP，仅作可选审计信息，不参与认证或限流 |
| status | VARCHAR(16) NOT NULL | pending/accepted/failed/unknown |
| smtp_message_id | TEXT | SMTP 返回的 Message-ID |
| smtp_envelope_from | VARCHAR(254) | SMTP 信封发件地址 |
| smtp_envelope_to | VARCHAR(254) | SMTP 信封收件地址 |
| smtp_response | TEXT | SMTP 响应摘要 |
| smtp_accepted | JSONB | 被 SMTP 接受的收件地址 |
| smtp_rejected | JSONB | 被 SMTP 拒绝的收件地址 |
| smtp_error_code | VARCHAR(64) | 错误代码 |
| smtp_error_detail | TEXT | 脱敏后的错误说明 |
| created_at | TIMESTAMPTZ NOT NULL | 创建时间 |
| submitted_at | TIMESTAMPTZ | 开始提交 SMTP 的时间 |
| completed_at | TIMESTAMPTZ | SMTP 调用结束时间 |
| duration_ms | INTEGER | SMTP 处理耗时 |
| updated_at | TIMESTAMPTZ NOT NULL | 最后更新时间 |
| resolved_at | TIMESTAMPTZ | 人工处理时间 |
| resolved_by_type | VARCHAR(32) | 处理者类型 |
| resolved_by_id | VARCHAR(200) | 处理者 ID |
| resolution_note | TEXT | 人工处理备注 |

唯一约束：

~~~text
UNIQUE (tenant_id, request_id)
~~~

同一个租户的同一个 request_id 只能对应一次发送动作。不同租户之间可以使用相同的 request_id。

### 4.8 send_request_contents：实际发送内容快照

| 字段 | 类型 | 说明 |
|---|---|---|
| send_request_id | BIGINT PRIMARY KEY REFERENCES send_requests(id) | 对应发送记录 |
| from_email | VARCHAR(254) NOT NULL | 实际发件地址 |
| from_name | VARCHAR(100) NOT NULL | 发送时的发件昵称 |
| reply_to | VARCHAR(254) | 发送时的回复地址 |
| subject | VARCHAR(200) NOT NULL | 实际标题 |
| html_body | TEXT NOT NULL | 实际发送的 HTML |
| text_body | TEXT NOT NULL | 实际发送的纯文本 |
| config_version | BIGINT NOT NULL | 发送时使用的配置版本 |
| created_at | TIMESTAMPTZ NOT NULL | 内容快照创建时间 |

该表与当前配置分离，保证租户修改模板后，历史记录仍然能够还原当时发送的邮件内容。

系统管理员可以查看完整正文。租户不能查看历史发送正文。

### 4.9 verification_codes：当前验证码状态

| 字段 | 类型 | 说明 |
|---|---|---|
| tenant_id | UUID NOT NULL REFERENCES tenants(id) | 所属租户 |
| email | VARCHAR(254) NOT NULL | 邮箱 |
| code | CHAR(6) NOT NULL | 当前验证码明文 |
| send_request_id | BIGINT NOT NULL REFERENCES send_requests(id) | 产生该验证码的发送记录 |
| attempts | INTEGER NOT NULL | 已错误尝试次数 |
| expires_at | TIMESTAMPTZ NOT NULL | 过期时间 |
| consumed_at | TIMESTAMPTZ | 成功核销时间 |
| created_at | TIMESTAMPTZ NOT NULL | 生成时间 |
| updated_at | TIMESTAMPTZ NOT NULL | 最后更新时间 |

主键：

~~~text
PRIMARY KEY (tenant_id, email)
~~~

验证码按租户和邮箱唯一。新发送会替换同一租户、同一邮箱的当前验证码。

验证码不做哈希，直接保存明文。接口不得返回验证码，日志不得记录验证码。

### 4.10 rate_limits：限流计数

| 字段 | 类型 | 说明 |
|---|---|---|
| tenant_id | UUID NOT NULL REFERENCES tenants(id) | 所属租户 |
| limit_type | VARCHAR(32) NOT NULL | email_cooldown/email_hour |
| email | VARCHAR(254) NOT NULL | 受限邮箱 |
| window_started_at | TIMESTAMPTZ NOT NULL | 限流窗口开始时间 |
| count | INTEGER NOT NULL | 当前窗口计数 |
| expires_at | TIMESTAMPTZ NOT NULL | 窗口结束时间 |
| updated_at | TIMESTAMPTZ NOT NULL | 最后更新时间 |

主键：

~~~text
PRIMARY KEY (tenant_id, limit_type, email)
~~~

默认规则：

- 同一邮箱 60 秒内最多发送 1 次；
- 同一邮箱 1 小时内最多发送 10 次；
- 同一租户所有 API 请求每分钟最多 120 次；
- SMTP 并发发送最多 2 个。

使用 PostgreSQL 的原子 UPSERT 更新邮箱限流计数，不引入 Redis。

---

## 5. 验证码和发送内容的区别

两张表承担不同责任：

| 表 | 记录内容 | 生命周期 |
|---|---|---|
| verification_codes | 当前验证码是否有效、是否核销、错误次数 | 过期后清理 |
| send_requests | 一次发送动作和发送结果 | 长期保留 |
| send_request_contents | 某次发送实际使用的邮件内容 | 长期保留 |

同一个邮箱可以有多条发送记录，但 verification_codes 只保存该租户当前有效的验证码状态。

---

## 6. 认证和权限

### 6.1 系统管理员

系统管理员仍使用环境变量账号，不增加复杂管理员组织结构。

管理员可以：

- 创建租户；
- 停用和启用租户；
- 创建和重置租户登录密码；
- 创建和重置 API Key；
- 增加总额度；
- 查看和修改租户邮件配置；
- 查看所有租户的发送记录；
- 查看完整 HTML 和纯文本；
- 查看 SMTP 信息；
- 处理 unknown 发送记录。

管理员不能通过普通接口直接修改已用额度和预占额度，只能通过发送结算或明确的人工处理流程改变。

### 6.2 租户账号

当前一个租户只有一个账号。

租户可以：

- 登录租户门户；
- 查看自己的额度；
- 查看自己的发送明细；
- 修改发件昵称；
- 修改标题；
- 修改 HTML 模板；
- 修改纯文本模板；
- 修改回复地址；
- 查看自己的当前模板。

租户不能：

- 查看其他租户数据；
- 查看历史发送的 HTML；
- 查看历史发送的纯文本；
- 查看验证码原文；
- 查看 SMTP 密码；
- 查看完整 API Key；
- 修改总额度；
- 修改已用额度；
- 修改启用状态；
- 修改 customer_id；
- 重置 API Key；
- 创建其他账号。

### 6.3 租户可查看的发送字段

租户发送记录接口只返回：

- 请求编号；
- 收件邮箱；
- 发送状态；
- 创建时间；
- 更新时间；
- 验证码过期时间；
- 可重发时间；
- SMTP Message-ID；
- 脱敏后的错误代码和说明；
- 当前配置版本。

租户接口不返回：

- HTML 正文；
- 纯文本正文；
- 验证码；
- SMTP 账号；
- 客户端 IP，除非后续明确需要；
- 其他租户字段。

---

## 7. API 设计

### 7.1 客户业务 API

认证请求头：

~~~http
X-Customer-Id: customer_a
Authorization: Bearer <api_key>
~~~

目标接口：

~~~text
POST /api/v1/verification-codes/send
GET  /api/v1/verification-codes/requests/:request_id
POST /api/v1/verification-codes/verify
~~~

发送接口只接收：

- request_id；
- email；
- reported_client_ip（可选，仅用于审计，不参与认证或限流）。

客户端不能提交：

- HTML；
- 纯文本；
- 标题；
- 发件地址；
- 总额度；
- 验证码；
- purpose；
- user_id；
- 任意自定义字段。

### 7.2 租户门户 API

固定目标路径：

~~~text
POST  /tenant/api/login
GET   /tenant/api/session
POST  /tenant/api/logout
GET   /tenant/api/me
GET   /tenant/api/quota
GET   /tenant/api/requests
GET   /tenant/api/config
PATCH /tenant/api/config
~~~

租户门户使用 HttpOnly、SameSite=Strict 的会话 Cookie，并使用 CSRF Token 保护写操作。

### 7.3 系统管理员 API

固定目标路径：

~~~text
GET   /admin/api/tenants
POST  /admin/api/tenants
GET   /admin/api/tenants/:customer_id
PATCH /admin/api/tenants/:customer_id
POST  /admin/api/tenants/:customer_id/api-key
POST  /admin/api/tenants/:customer_id/password
POST  /admin/api/tenants/:customer_id/quota
GET   /admin/api/requests
GET   /admin/api/requests/:id
POST  /admin/api/requests/:id/resolve
GET   /admin/api/stats
~~~

所有管理写操作继续要求管理员会话、Origin 校验和 CSRF Token。

---

## 8. 发送和额度事务

发送流程必须拆成两个阶段。

### 阶段一：数据库事务内预占

事务内完成：

1. 根据 tenant_id 锁定 tenant_quotas 行；
2. 检查租户存在且启用；
3. 检查额度是否足够；
4. 检查邮箱限流；
5. 创建 send_requests；
6. 创建 send_request_contents；
7. 增加 reserved_count；
8. 创建或替换 verification_codes；
9. 更新 rate_limits。

SMTP 网络请求不能放在这笔数据库事务中。

### 阶段二：SMTP 发送和结果结算

SMTP 调用结束后，再开启短事务：

- accepted：减少 reserved_count，增加 used_count；
- failed：减少 reserved_count，不增加 used_count，删除对应不可用验证码；
- unknown：保留 reserved_count，等待管理员人工处理；
- 进程崩溃后，未结算的 pending 记录恢复为 unknown，不能自动重发。

---

## 9. 数据隔离要求

每个租户业务查询都必须使用内部 tenant_id。

禁止只根据客户端传入的 customer_id 直接拼接 SQL。正确流程是：

~~~text
X-Customer-Id
  -> 查询 tenants.customer_id
  -> 得到 tenants.id
  -> 请求上下文保存 tenant_id
  -> 后续业务 SQL 使用 tenant_id
~~~

必须测试：

- 租户 A 不能读取租户 B 的发送记录；
- 租户 A 不能读取租户 B 的验证码；
- 租户 A 不能触发租户 B 的限流；
- 租户 A 不能使用租户 B 的请求编号查询记录；
- 租户 A 不能修改租户 B 的配置；
- 相同邮箱在不同租户下验证码互不覆盖；
- 相同 request_id 在不同租户下可以独立存在；
- 额度和发送记录不能跨租户累计。

---

## 10. 安全要求

1. 客户 API 和租户门户强制 HTTPS。
2. API Key 不放入浏览器、URL、日志和前端构建产物。
3. API Key 只在创建或重置时显示一次。
4. 登录密码使用 bcrypt 或同等强度密码哈希。
5. 验证码明文存储，但不通过任何接口返回。
6. 验证码不记录到日志、异常信息和调试输出。
7. 租户接口不能把验证码作为查询参数。
8. 租户接口不能查询 send_request_contents。
9. 管理员查看完整邮件正文必须经过管理员会话认证。
10. 所有管理写操作使用 CSRF Token。
11. 所有 SQL 使用参数化查询。
12. 数据库账号只授予应用所需权限。
13. SMTP 错误返回前必须脱敏，不能把 SMTP 密码或连接细节返回给租户。
14. 租户停用后，发送、查询和核验接口都拒绝新请求，但历史数据保留。

---

## 11. 配置和部署

### 应用

- 单个 Node.js 进程；
- 使用 PostgreSQL 连接池，最大 2～5 个连接；
- SMTP 并发最多 2 个；
- 不使用 Redis；
- 不使用消息队列；
- 不使用 ORM；
- 前端静态资源继续由 Express 提供；
- 管理员门户和租户门户由同一个 Node.js 服务托管。

### PostgreSQL

- 使用 Docker Compose 运行；
- 数据目录使用持久化卷；
- 数据库不暴露到公网；
- 只允许应用容器和本机管理连接；
- 应用通过 DATABASE_URL 连接；
- 不在数据库容器中运行其他业务。

### 初始化

启动初始化必须：

1. 创建数据库表和索引；
2. 写入中文表注释和字段注释；
3. 创建空租户集合；
4. 不导入旧 SQLite；
5. 不读取旧 customers.json；
6. 数据库已存在时只补充缺失表、字段和索引；
7. 不删除字段、不修改已有字段类型、不修改已有业务数据；
8. 数据库连接或必要结构无法完成时启动失败。

---

## 12. 发送内容保留

系统管理员可以查看完整的历史邮件 HTML 和纯文本。租户不能查看历史正文。

send_request_contents 与 send_requests 分表，正文当前长期保留，未来如需清理必须作为独立产品变更处理。

完整邮件正文长期保留，不自动清理。系统管理员可以查看完整的历史 HTML 和纯文本内容，租户不能查看历史正文。

如果未来增加清理功能，必须作为单独的产品变更设计，并明确备份、恢复和审计影响。

---

## 13. 验证要求

最小充分验证应覆盖：

### 数据库

- 初始化和重复初始化；
- 外键约束；
- 租户唯一性；
- 额度非负约束；
- 发送记录和配置内容关联；
- 验证码主键隔离；
- 限流联合主键和 UPSERT。

### 业务

- 跨租户访问被拒绝；
- API Key 和 X-Customer-Id 不匹配被拒绝；
- 额度并发预占只能成功允许的次数；
- 发送结果 accepted、failed、unknown 的结算；
- unknown 只能人工处理一次；
- 验证码错误次数、过期和单次核销；
- 租户只能修改允许的邮件配置；
- 租户不能修改额度、状态、API Key 和租户编号。

### 前端

- 系统管理员登录和租户登录互相隔离；
- 租户看不到管理员页面；
- 租户发送记录不包含正文；
- 管理员可以查看完整发送内容；
- 模板预览不发送邮件、不消耗额度；
- Cookie、CSRF 和登出行为正常。

---

## 14. 明确不实现的内容

当前版本不实现：

- 一个租户下多个账号；
- 角色和权限层级；
- 在线购买额度；
- 按月额度重置；
- 批量群发；
- 任意正文发送；
- 短信；
- 多应用实例；
- Redis 限流；
- 消息队列；
- 多节点高可用；
- 邮件打开、点击和送达追踪；
- 自动导入旧 SQLite；
- 自动导入旧 customers.json；
- 租户删除和租户编号复用。

---

## 15. 开发顺序建议

1. 建立 PostgreSQL 初始化 SQL 和数据库访问层；
2. 建立租户、租户账号、API Key、邮件配置和额度表；
3. 重写客户认证和租户上下文；
4. 重写额度预占、发送记录、验证码和限流事务；
5. 实现 SMTP 发送结果记录；
6. 实现系统管理员租户管理；
7. 实现租户登录和租户门户 API；
8. 实现租户配置页面和发送记录页面；
9. 删除旧的 SQLite、JSON 配置和文件模板依赖；
10. 更新 Docker Compose、README、API 文档和测试；
11. 完成跨租户隔离和并发验证。








