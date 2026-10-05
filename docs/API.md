# API 与前端接入契约

管理端已在 `/admin/` 通过同一服务同源提供，源码在 `frontend/`。所有时间为 UTC Unix 毫秒；UI 按 Asia/Shanghai 显示并标注时区。所有 JSON 请求严格拒绝未知字段。

## 通用响应

```json
{"success":true,"code":"VERIFIED","message":"验证成功"}
```

错误返回 `success:false`、稳定 `code`、中文 `message`，必要时附 `data`。不得用提示文字或单独 `success` 判断发送状态。429 包含 `Retry-After` 响应头、顶层 `retry_after_seconds` 与 `data.retry_after_seconds`。

## 客户认证

每次带 `X-Customer-Id: customer_a` 和 `Authorization: Bearer <api_key>`。仅允许客户后端调用，禁止把密钥交给浏览器。应用校验 ID、密钥、启用状态；每客户发送/查询/核验合计每分钟 120 次。

### POST /api/v1/verification-codes/send

```json
{"request_id":"b9199534-97fb-4d68-ae66-b4c02c278f94","email":"user@example.com","client_ip":"203.0.113.10"}
```

邮箱去首尾空格并小写，不改写加号或点号；IPv4/IPv6 规范化，IPv4 映射 IPv6 合并为 IPv4。IP 必须由客户后端按受信代理链提取，不能直接信任浏览器提供值。

| HTTP | code | 含义 |
| --- | --- | --- |
| 200 | SEND_ACCEPTED | SMTP 明确受理，已计用量；不保证进入收件箱 |
| 202 | SEND_PENDING | 原请求处理中，`success:false` |
| 202 | SEND_UNKNOWN | 待确认，`success:false`，保留占用 |
| 503 | SEND_FAILED | 明确失败且释放已提交 |

以上均含 `data: {request_id,status,expires_at,resend_available_at}`，时间由原发送记录推算。历史请求的验证码可能已被新请求替换或核销，不承诺当前有效。同一 UUID 重试返回原记录当前状态，不续期，不重发。编号相同但规范化邮箱/IP 不同返回 409 `REQUEST_CONFLICT`。

### GET /api/v1/verification-codes/requests/{request_id}

HTTP 200 `REQUEST_FOUND`，`success:true` 表示查询成功；同样返回四个 data 字段。必须继续检查 `data.status`。其他客户或不存在记录统一返回 404 `REQUEST_NOT_FOUND`。

客户后端请求超时设为 20 秒。超时后优先查询原编号；404 时可用原编号、原邮箱/IP 重试。查询/网络重试合计最多自动 2 次，仍未确认即提示稍后处理并保留编号；禁止自动生成新 UUID 重发。新 UUID 仅对应用户明确发起的新发送。

### POST /api/v1/verification-codes/verify

```json
{"email":"user@example.com","code":"083721"}
```

HTTP 200 `VERIFIED` 为单次核销成功，不提供成功重放。禁止自动重试核销。响应丢失或随后客户数据库操作失败，用户重新获取验证码。额度耗尽仍可核验，客户停用后拒绝。

### 客户错误码

| HTTP | code |
| --- | --- |
| 400 | INVALID_ARGUMENT、CODE_INVALID、CODE_EXPIRED、CODE_CONSUMED、CODE_ATTEMPTS_EXCEEDED、HTTPS_REQUIRED |
| 401 | AUTH_INVALID |
| 403 | CUSTOMER_DISABLED |
| 404 | REQUEST_NOT_FOUND |
| 409 | REQUEST_CONFLICT、QUOTA_EXHAUSTED |
| 429 | EMAIL_COOLDOWN、EMAIL_HOURLY_LIMIT、IP_HOURLY_LIMIT、CUSTOMER_RATE_LIMIT |
| 503 | SERVICE_BUSY、SERVICE_UNAVAILABLE、SEND_FAILED |
| 202 | SEND_PENDING、SEND_UNKNOWN |

`CODE_INVALID` 附 `data.attempts_remaining`；第五次错误直接返回 `CODE_ATTEMPTS_EXCEEDED`。格式非法不增加错误次数。`SERVICE_BUSY` 不创建发送记录、不占用、不增加邮件频率。结算失败的 `SERVICE_UNAVAILABLE` 附原请求编号，不能假定已退量。所有服务故障必须与验证码错误区分。

Nginx按实际连接来源的保护返回429 `SOURCE_RATE_LIMIT`，不依赖客户身份，含Retry-After。

## 管理认证

单管理员独立认证，Cookie 会话绝对有效期 8 小时，重启需重登。Cookie 为 `mailquota.sid`，HttpOnly、SameSite=Strict；PUBLIC_ORIGIN为HTTPS时设置Secure并校验HTTPS请求，为HTTP时允许本地HTTP会话。管理接口不接受客户密钥替代登录。

`POST /admin/api/login`：`{"username":"admin","password":"..."}`。需要 `Origin` 与 `PUBLIC_ORIGIN` 完全一致。成功返回 `data.username`、`data.csrf_token` 和 `data.sender`（实际发信地址，仅用于邮件预览显示）并设置 Cookie。同来源 15 分钟最多 10 次失败；429 `LOGIN_RATE_LIMIT`。

`GET /admin/api/session`：返回与登录相同的三个字段。

登录后所有管理写操作带 Cookie、正确 Origin 和 `X-CSRF-Token`。前端使用同源 fetch，默认发送 Cookie，token 保存在页面内存即可。登录不要求已有 CSRF token，但检查 Origin。无会话为 401 `ADMIN_AUTH_REQUIRED`，CSRF 失败为 403 `CSRF_INVALID`。

`POST /admin/api/logout`：销毁会话。

## 管理操作

以下路径统一前缀 `/admin/api`。创建/编辑完整校验后原子替换配置文件，所有编辑均提供当前 `version`。冲突返回 409 `EDIT_CONFLICT`，重新读取后人工确认修改，不能静默覆盖。停用、重置密钥、人工结算前的二次确认由管理端界面负责，接口不再要求 `confirmed` 字段。

### 客户

| 方法与路径 | 说明 |
| --- | --- |
| GET /customers | 返回全部客户 `data.items`（不分页，不含真实密钥和 HTML） |
| POST /customers | 创建，HTTP 201，返回公共详情及仅此时可见的 `api_key` |
| GET /customers/{id} | 公共详情加 `html`（当前 HTML 模板） |
| PATCH /customers/{id} | 一次修改任意若干项，返回公共详情加 `html` |
| POST /customers/{id}/key | `{"version":1}`，重置密钥，返回公共详情及完整新 `api_key` |

公共详情包含客户配置、`version`、`api_key_mask`、`quota_total,used_count,reserved_count,available_count`。

创建必填 `customer_id,name,from_name,subject,text_template,reply_to,html`；可选 `enabled`（默认false）、`quota_total`（默认0）：

```json
{
  "customer_id":"customer_a","name":"示例客户","enabled":false,"quota_total":0,
  "from_name":"示例网站","subject":"邮箱验证码","reply_to":"",
  "text_template":"您的验证码为 {{code}}，{{expires_minutes}} 分钟内有效。",
  "html":"<p>您的验证码为 <strong>{{code}}</strong>，{{expires_minutes}} 分钟内有效。</p>"
}
```

`customer_id` 不可修改、不允许删除，也不允许复用遗留用量行；重名返回409 `CUSTOMER_EXISTS`。名称必填、最多200字符。

`PATCH /customers/{id}` 接受 `version` 加上 `name,enabled,quota_total,from_name,subject,reply_to,text_template,html` 中的至少一项，未出现的保持不变：

```json
{"version":3,"from_name":"示例网站","subject":"邮箱验证码","html":"<p>{{code}}</p>"}
```

- 提交的各项在同一次原子发布中生效，版本只推进 1；任一项非法则整次不生效。
- `quota_total` 提交目标总数，非“加 N”；同一请求重试因版本冲突不会重复增额。只许非负安全整数且不能降低，不提供清零或直接修改计数。
- 停用后该客户的发送、查询、核验全部拒绝；已开始的发送继续按原配置结算。
- 昵称最多100字符，标题最多200字符，禁止控制字符和换行；静态标题不执行变量或表达式。reply_to 可为空，非空时为单个邮箱。
- 纯文本最多16KiB，HTML最多256KiB；两者必须有 `{{code}}`，仅另支持 `{{expires_minutes}}`。提交 `html` 时模板另存为新的版本化文件。

重置密钥后旧密钥立即失效，额度和历史不变。

### 模板预览

服务端不提供预览接口。管理端在浏览器本地把 `{{code}}` 替换为固定示例 083721、`{{expires_minutes}}` 替换为 5，与真实发信使用同一套替换规则；不发送邮件、不消耗额度、不抓取素材。

预览只能放进 `<iframe sandbox="" referrerpolicy="no-referrer">` 的 srcdoc，并在模板内容之前写入等效的 CSP（不允许脚本、同源能力、表单、任意资源，仅允许HTTPS图片及内联样式）。绝不能插入管理页面 DOM，不能加 allow-scripts/allow-same-origin。编辑源代码可以作为 textarea 的文本值显示。

### 统计

`GET /stats?days=14`（1–90，默认14）：按北京时间分日的发送统计。

```json
{
  "days":["2026-09-21","…","2026-10-04"],
  "customers":{"customer_a":{"accepted":[120,131],"failed":[0,1],"unknown":[0,0],"pending":[0,0]}},
  "unresolved":1
}
```

`days` 从早到晚，最后一项是今天；每个状态的数组与 `days` 一一对应。时间窗内没有发送的客户不出现在 `customers` 中。`unresolved` 是全部 `unknown` 记录数，不受时间窗限制。

### 发送记录与结果不明的处理

`GET /requests` 支持 `customer_id,status,q,from,to,page,page_size`；from/to 是毫秒整数（含边界）；默认20，最多100，不一次返回全部历史。`q` 按邮箱包含匹配（不区分大小写，`%` 和 `_` 按字面处理），整段等于请求 UUID 时同样命中。返回 `data.items,total,page,page_size`。

`GET /requests/{内部id}`：返回单条记录，不存在为 404 `REQUEST_NOT_FOUND`。

记录包含规范定义的发送记录字段：id、客户ID、请求UUID、邮箱、IP、状态、SMTP消息ID、脱敏错误代码/说明、创建/更新时间、人工处理时间/管理员/备注。不含验证码或邮件正文。`status=unknown` 即结果不明、等待人工核查的记录。

`POST /requests/{内部id}/resolve`：

```json
{"status":"accepted","note":"已根据服务商记录确认受理"}
```

status 仅 accepted/failed；note 选填，最多2000字符。只允许处理 unknown，原发送结果已隔离；重复处理409 `STATE_CONFLICT`，刷新当前结果。返回完整处理后记录。不会重发邮件、恢复过期或已被替换验证码。

## 健康与静态文件

`GET /health/live` 进程存活；`GET /health/ready` 检查数据库和必要配置。无需登录且不发真实邮件；Nginx 示例禁止外网访问健康路径。配置、数据库、实际邮件模板源文件不进行静态托管。`GET /` 与 `GET /admin` 跳转 `/admin/`；`GET /admin/` 及其下的页面地址提供不含客户数据的管理页面壳，`/admin/assets/` 只提供 `public/admin` 下的静态资源，所有真实管理数据仍需要认证。页面壳与接口响应为 `no-store`；`/admin/assets/assets/` 下文件名带内容哈希的脚本、样式和字体长期缓存。
