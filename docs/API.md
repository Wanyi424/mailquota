# API 与前端接入契约

管理端已在 `/admin/` 通过同一服务同源提供，页面设计与手动验收见 [FRONTEND.md](FRONTEND.md)。所有时间为 UTC Unix 毫秒；UI 按 Asia/Shanghai 显示并标注时区。所有 JSON 请求严格拒绝未知字段。

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

`POST /admin/api/login`：`{"username":"admin","password":"..."}`。需要 `Origin` 与 `PUBLIC_ORIGIN` 完全一致。成功返回 `data.username` 与 `data.csrf_token` 并设置 Cookie。同来源 15 分钟最多 10 次失败；429 `LOGIN_RATE_LIMIT`。

`GET /admin/api/session`：获取当前 username 和 csrf_token。

登录后所有管理写操作带 Cookie、正确 Origin 和 `X-CSRF-Token`。前端使用同源 fetch，默认发送 Cookie，token 保存在页面内存即可。登录不要求已有 CSRF token，但检查 Origin。无会话为 401 `ADMIN_AUTH_REQUIRED`，CSRF 失败为 403 `CSRF_INVALID`。

`POST /admin/api/logout`：销毁会话。管理变更应发送 JSON；禁用按钮直至请求完成。

## 管理操作

创建/编辑完整校验后原子替换配置文件，所有编辑均提供当前 `version`。冲突返回 409 `EDIT_CONFLICT`，重新读取后人工确认修改，不能静默覆盖。JSON 配置与 HTML 分别保存；HTML 保存也推进客户版本，所以保存后需要更新页面版本。

### 客户列表和详情

- `GET /admin/api/customers?page=1&page_size=20`：`data.items,total,page,page_size`，最大每页100。
- `GET /admin/api/customers/{id}`：返回客户完整配置（不含真实密钥和 HTML）、`version`、`api_key_mask`、`quota_total,used_count,reserved_count,available_count`。
- `POST /admin/api/customers`：创建，HTTP201。必填 `customer_id,name,from_name,subject,text_template,reply_to,html`；可选 `enabled`（默认false）、`quota_total`（默认0）。返回公共详情及仅此时可见的 `api_key`。

```json
{
  "customer_id":"customer_a","name":"示例客户","enabled":false,"quota_total":0,
  "from_name":"示例网站","subject":"邮箱验证码","reply_to":"",
  "text_template":"您的验证码为 {{code}}，{{expires_minutes}} 分钟内有效。",
  "html":"<p>您的验证码为 <strong>{{code}}</strong>，{{expires_minutes}} 分钟内有效。</p>"
}
```

`customer_id` 不可修改、不允许删除，也不允许复用遗留用量行；重名返回409 `CUSTOMER_EXISTS`。名称必填、最多200字符。

### 名称、启停、密钥与额度

| 方法与路径（统一前缀 /admin/api） | JSON 请求 |
| --- | --- |
| PATCH /customers/{id} | `{"version":1,"name":"新名称"}` |
| PUT /customers/{id}/enabled | `{"version":1,"enabled":false,"confirmed":true}` |
| POST /customers/{id}/key/reset | `{"version":1,"confirmed":true}` |
| PUT /customers/{id}/quota | `{"version":1,"quota_total":1000}` |

这些接口返回保存后的公共详情，密钥重置另附完整新 `api_key`，旧密钥立即失效。版本均推进1。

UI 必须在停用和重置密钥前展示影响并二次确认，再发 `confirmed:true`；该字段为交互契约，不能取代权限校验。启用接口同样要求该字段。已开始发送继续按原配置结算。

额度提交目标总数，非“加 N”；同一请求重试因版本冲突不会重复增额。UI 可输入增加量再计算目标。只许非负安全整数且不能降低，不提供清零或直接修改计数。

### 邮件设置与模板

`PUT /admin/api/customers/{id}/mail`：`version,from_name,subject,reply_to,text_template` 全部必填；返回公共详情。

- 昵称最多100字符，标题最多200字符，禁止控制字符和换行；静态标题不执行变量或表达式。
- reply_to 可为空，非空时为单个邮箱。
- 纯文本最多16KiB，HTML最多256KiB；两者必须有 `{{code}}`，仅另支持 `{{expires_minutes}}`。
- `GET /admin/api/customers/{id}/template`：返回 `data.html,version`。
- `PUT /admin/api/customers/{id}/template`：`{"version":1,"html":"<p>{{code}}</p>"}`，返回新version。
- `POST /admin/api/template/preview`：`{"html":"<p>{{code}}</p>"}`，返回 `text/html`，示例验证码固定083721，带 CSP sandbox（不允许脚本、同源能力、表单、任意资源，仅允许HTTPS图片及内联样式）。不发送真实邮件、不消耗额度、不抓取素材。

前端以 `<iframe sandbox="" referrerpolicy="no-referrer">` 展示预览。通过 fetch 获取 HTML 再写入 iframe.srcdoc 时，HTTP CSP 不随文本转移，必须保留空 sandbox 且在 srcdoc 中使用等效 CSP。当前管理端会在模板内容之前加入该限制。绝不能插入管理页面 DOM，不能加 allow-scripts/allow-same-origin。编辑源代码可以作为 textarea 的文本值显示。

### 发送记录与待确认处理

`GET /admin/api/requests` 支持 `customer_id,status,email,from,to,page,page_size`；from/to 是毫秒整数（含边界）。email 精确匹配规范化邮箱；默认20，最多100。返回 `data.items,total,page,page_size`。

记录包含规范定义的发送记录字段：id、客户ID、请求UUID、邮箱、IP、状态、SMTP消息ID、脱敏错误代码/说明、创建/更新时间、人工处理时间/管理员/依据。不含验证码或邮件正文。`status=unknown` 即待确认列表。

`POST /admin/api/requests/{内部id}/resolve`：

```json
{"status":"accepted","note":"已根据服务商记录确认受理","confirmed":true}
```

status 仅 accepted/failed；note 去空白后必填、最多2000字符；UI 必须二次确认并说明扣量或释放的影响。只允许 unknown，原发送结果已隔离；重复处理409 `STATE_CONFLICT`，刷新当前结果。返回完整处理后记录。不会重发邮件、恢复过期或已被替换验证码。

## 健康与静态文件

`GET /health/live` 进程存活；`GET /health/ready` 检查数据库和必要配置。无需登录且不发真实邮件；Nginx 示例禁止外网访问健康路径。配置、数据库、实际邮件模板源文件不进行静态托管。`GET /` 与 `GET /admin` 跳转 `/admin/`；`GET /admin/` 提供不含客户数据的管理页面壳，`/admin/assets/` 只提供 `public/admin` 下的静态资源，所有真实管理数据仍需要认证。
