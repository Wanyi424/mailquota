# MailQuota 前端接入说明

版本：1.0  
适用后端：多租户 PostgreSQL 版本

## 1. 两套前端入口

系统有两套完全独立的会话：

- 管理员前端：`/admin/`
- 租户前端：`/tenant/`

管理员会话 Cookie 与租户会话 Cookie 不共用。前端不要把 API Key 或租户密码保存到 localStorage、URL 或前端构建产物。

所有请求使用 JSON。成功响应格式：

```json
{ "success": true, "code": "CODE", "message": "操作成功", "data": {} }
```

失败响应格式：

```json
{ "success": false, "code": "ERROR_CODE", "message": "错误说明", "data": {} }
```

## 2. 租户门户

### 登录

```http
POST /tenant/api/login
Content-Type: application/json
Origin: https://实际站点
```

请求：

```json
{ "login_name": "customer_a", "password": "租户密码" }
```

成功返回 `data.csrf_token`。浏览器会自动保存 HttpOnly 会话 Cookie，前端只需把 CSRF Token 放入后续写请求的 `X-CSRF-Token`。

### 会话和登出

```http
GET  /tenant/api/session
POST /tenant/api/logout
```

登出属于写请求，需要：

```http
Origin: https://实际站点
X-CSRF-Token: <csrf_token>
```

### 租户信息和额度

```http
GET /tenant/api/me
GET /tenant/api/quota
```

额度返回字段：

| 字段 | 含义 |
|---|---|
| `quota_total` | 总额度 |
| `used_count` | 已确认消耗数量 |
| `reserved_count` | 发送中或结果不明的预占数量 |
| `available_count` | 可用额度 |

### 邮件配置

```http
GET   /tenant/api/config
PATCH /tenant/api/config
```

当前配置返回：

- `from_name`：发件昵称；
- `subject`：邮件标题；
- `html_template`：HTML 模板；
- `text_template`：纯文本模板；
- `reply_to`：回复地址；
- `version`：配置版本。

更新示例：

```json
{
  "version": 3,
  "from_name": "示例网站",
  "subject": "登录验证码",
  "html_template": "<p>验证码：{{code}}</p>",
  "text_template": "验证码：{{code}}",
  "reply_to": "support@example.com"
}
```

模板只能使用 `{{code}}` 和 `{{expires_minutes}}`。保存时必须携带当前 `version`；版本过期返回 `EDIT_CONFLICT`，前端应重新读取配置后提示用户合并修改。

### 发送记录

```http
GET /tenant/api/requests
```

返回：

- `request_id`
- `email`
- `status`
- `created_at`
- `updated_at`
- `code_expires_at`
- `resend_available_at`
- `smtp_message_id`
- `smtp_error_code`
- `smtp_error_detail`

租户接口不会返回验证码、HTML 正文、纯文本正文、SMTP 账号或 API Key。

## 3. 客户业务 API

业务项目使用 API Key，不使用租户网页登录 Cookie：

```http
X-Customer-Id: customer_a
Authorization: Bearer <tenant_api_key>
```

发送验证码：

```http
POST /api/v1/verification-codes/send
Content-Type: application/json

{
  "request_id": "UUID",
  "email": "user@example.com",
  "reported_client_ip": "203.0.113.10"
}
```

`reported_client_ip` 可不传，只用于审计，不参与认证和限流。

查询发送结果：

```http
GET /api/v1/verification-codes/requests/:request_id
```

核验验证码：

```http
POST /api/v1/verification-codes/verify
{ "email": "user@example.com", "code": "123456" }
```

同一租户的 `request_id` 必须保持幂等。重复提交相同参数返回原记录；修改邮箱会返回 `REQUEST_CONFLICT`。

常见状态：

- `accepted`：SMTP 服务商已接受；
- `failed`：明确发送失败；
- `unknown`：结果无法确认，需要查询或管理员处理。

常见错误：

| 错误码 | 前端处理 |
|---|---|
| `AUTH_INVALID` | 检查 `X-Customer-Id` 和 API Key |
| `TENANT_DISABLED` | 联系管理员 |
| `QUOTA_EXHAUSTED` | 提示额度不足 |
| `EMAIL_COOLDOWN` | 按响应中的重试时间等待 |
| `EMAIL_HOURLY_LIMIT` | 等待限流窗口结束 |
| `REQUEST_CONFLICT` | 不要复用该请求编号发送其他邮箱 |
| `SERVICE_BUSY` | 稍后重试，不能立即改变 request_id 重发 |

## 4. 管理员前端

管理员登录：

```http
POST /admin/api/login
{ "username": "admin", "password": "管理员密码" }
```

写请求必须同时带：

```http
Origin: https://实际站点
X-CSRF-Token: <csrf_token>
```

主要接口：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/admin/api/tenants` | 租户列表 |
| POST | `/admin/api/tenants` | 创建租户 |
| GET | `/admin/api/tenants/:customer_id` | 租户详情 |
| PATCH | `/admin/api/tenants/:customer_id` | 修改租户和邮件配置 |
| POST | `/admin/api/tenants/:customer_id/api-key` | 重置 API Key |
| POST | `/admin/api/tenants/:customer_id/password` | 重置租户密码 |
| POST | `/admin/api/tenants/:customer_id/quota` | 增加或减少额度 |
| GET | `/admin/api/requests` | 所有发送记录 |
| GET | `/admin/api/requests/:id` | 发送详情和完整正文 |
| POST | `/admin/api/requests/:id/resolve` | 处理 unknown |
| GET | `/admin/api/quota-details` | 额度变动明细 |
| GET | `/admin/api/stats` | 发送统计 |

创建租户时必须提交：

```json
{
  "customer_id": "customer_a",
  "name": "客户 A",
  "login_name": "customer_a",
  "password": "至少 12 位密码",
  "from_name": "示例网站",
  "subject": "验证码",
  "html_template": "<p>{{code}}</p>",
  "text_template": "验证码：{{code}}",
  "reply_to": "",
  "quota_total": 1000,
  "enabled": true
}
```

创建或重置 API Key 后，完整 API Key 只在响应中返回一次，前端应明确提示管理员立即复制保存，不得长期存储。

额度调整请求：

```json
{
  "request_id": "UUID",
  "delta": -100,
  "reason": "本月额度调整"
}
```

`delta` 为正数表示增加，为负数表示减少。减少后不能低于已使用和预占额度。

## 5. 页面实现边界

租户页面可以展示当前配置模板，因为这是租户正在编辑的内容；历史发送记录页面严禁展示 `send_request_contents（发送内容快照表）` 中的 HTML 和纯文本。

管理员详情页可以展示完整发送正文、SMTP 状态和人工处理信息。验证码原文无论管理员还是租户页面都不展示。

前端不应根据 HTTP 状态码以外的字符串猜测权限；统一依据 `success` 和 `code` 处理。遇到 `401` 清除页面状态并回到登录页，遇到 `403` 提示 CSRF 或权限问题，遇到 `409` 刷新数据后让用户重新提交。
