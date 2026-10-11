# 部署、初始化与恢复

应用使用 PostgreSQL，通过 `DATABASE_URL` 连接。PostgreSQL 可以运行在宿主机、远程服务器或 Docker 内。

## 启动

配置 `.env` 后直接启动：

```bash
npm start
```

Node.js 启动时会在事务中执行 `migrations/001.sql`：

- 缺失表使用 `CREATE TABLE IF NOT EXISTS` 创建；
- 缺失字段使用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 补充；
- 缺失索引使用 `CREATE INDEX IF NOT EXISTS` 创建；
- 不删除字段；
- 不修改已有字段类型；
- 不修改已有业务数据。

如果现有数据库结构与业务要求不兼容，事务回滚，服务拒绝启动，需要人工处理。

`npm run init` 使用同一套结构检查逻辑，可作为部署前预检查，不是每次启动的必需步骤。

## Docker PostgreSQL

连接宿主机或远程 PostgreSQL：

```bash
docker compose up -d
```

此时应用使用 `.env` 中的 `DATABASE_URL`。

同时启动 Compose 内 PostgreSQL：

```bash
POSTGRES_PASSWORD=change-me docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
```

Windows PowerShell：

```powershell
$env:POSTGRES_PASSWORD = "change-me"
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
```

## 备份

数据库备份使用 PostgreSQL 的 `pg_dump`。备份前停止应用发送，确保备份期间没有未完成的人工处理。

## 数据原则

旧 SQLite 和 `customers.json` 不会自动导入。邮件正文长期保留，验证码和邮箱限流数据按照业务过期清理。
