# API 与前端接入契约

当前多租户接口以 [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md) 和 [MULTI_TENANT_REFACTOR_SPEC.md](./MULTI_TENANT_REFACTOR_SPEC.md) 为准。

主要入口：

- 业务 API：`/api/v1`，使用 `X-Customer-Id` 和 `Authorization: Bearer`；
- 租户门户：`/tenant/api`，使用租户会话 Cookie 和 CSRF Token；
- 管理员 API：`/admin/api`，使用管理员会话 Cookie 和 CSRF Token。

旧 SQLite 版本中的 `client_ip`、文件配置和旧客户 API 不再适用；业务请求中的可选审计字段为 `reported_client_ip`。