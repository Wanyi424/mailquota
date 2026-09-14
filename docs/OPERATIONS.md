# 部署与运维

## 生产准备

一台主机、一个容器、一个Node进程。SQLite/配置/模板挂载本机磁盘。不要将目录交给客户、公开HTTP下载、放网络共享盘，或多副本并行运行。

1. 准备HTTPS域名及证书、阿里云发信地址和SMTP账号。
2. `cp .env.example .env`；`npm ci` 后 `npm run password` 生成管理员密码哈希和随机会话密钥，保留哈希两侧单引号（Compose避免把bcrypt的美元符解释成变量）。填入所有空配置，PUBLIC_ORIGIN为不带尾斜线的HTTPS origin。
3. 在目标部署平台构建 `docker compose build`。Docker使用独立构建阶段编译SQLite扩展，运行镜像不含编译器；低内存生产机优先在同架构构建机构建并导入镜像，不在可用内存不足1GB的机器强行编译依赖。
4. Linux宿主机预建 `storage`，设置所有者1000:1000、目录权限700。服务以node用户运行。首次运行 `docker compose run --rm mailquota node scripts/init.js`，初始化空客户配置与数据库。已有目录拒绝重复初始化。
5. `docker compose up -d`，检查 `docker compose logs --tail=50 mailquota` 和 `docker compose ps`。
6. 安装 `deploy/nginx.conf` 示例，替换域名、证书路径；将limit_req_zone置于http上下文，`nginx -t`通过后重新加载。
7. 通过管理API登录、创建客户，配置客户模板和额度，然后明确启用。将完整密钥安全交给该客户后端，日后无法从管理API查询完整密钥。

HOST默认127.0.0.1；容器内部覆写0.0.0.0，但宿主端口仅发布到127.0.0.1。Compose将TRUST_PROXY设为loopback,uniquelocal，以接收Docker网桥上的宿主Nginx请求；因此必须保持端口仅回环发布，Nginx必须覆盖X-Forwarded-Proto和X-Forwarded-For。若代理架构变化，应配置实际可信代理IP/CIDR，不直接暴露应用端口。

SMTP_SECURE=true表示465等直接TLS；false启用强制STARTTLS（不是允许明文SMTP）。SMTP_FROM为实际发信地址，昵称来自客户配置。禁止关闭证书校验。

## 管理操作

详见API.md。管理页尚未交付时可使用支持Cookie的API客户端，Origin设为PUBLIC_ORIGIN，登录后携带X-CSRF-Token。

- 新建客户默认0额度、停用；配置完整后明确启用。
- 增加额度读取详情的version，提交目标quota_total，不能降低。
- 重置密钥需confirmed:true；旧密钥立即失效，历史与用量不变，已开始发送继续结算。
- 待确认记录查询status=unknown，根据阿里云控制台核查，填写依据后确认受理或释放。不要仅因超时、退信、垃圾箱或用户声称未收到就释放。
- 忘记管理员密码：服务器重新生成密码哈希、更新.env、重建服务；会话全部失效。

## 健康、日志和关停

`/health/live`为存活，`/health/ready`验证必要持久化和配置，异常返回503。配置不合法会拒绝启动，不静默重建。日志仅记录时间、事件、客户ID、请求ID、状态及稳定代码，不输出原异常、验证码、邮箱、IP或密码。Compose日志10MiB×3轮换，宿主Nginx错误日志使用系统logrotate。

应用收到SIGTERM/SIGINT后先停止接收新发送，等待有界时间，15秒SMTP截止后保留unknown占用，关闭数据库。Compose stop_grace_period=25s；不要用强杀替代正常升级停止。强杀后重启会把遗留pending转unknown，绝不自动重发或退量。

每小时应用内清理过期验证码和发送限流，不删除永久用量和发送历史。人工处理不会恢复历史验证码。版本化旧模板文件保留以避免配置发布失败破坏有效模板；低频手工编辑场景不自动清理，未来可在停服完整备份后清理未被customers.json引用的模板。

## 每日备份

默认短暂停服获取整套一致快照，避免只复制活跃SQLite主文件遗漏WAL。

```sh
cd /opt/mailquota
sh scripts/backup.sh /opt/mailquota/backups
```

脚本停止服务，打包完整storage（含可能存在的WAL/SHM），完成后启动服务。建议root或部署账号每日凌晨执行，例如crontab：

```cron
15 3 * * * cd /opt/mailquota && sh scripts/backup.sh /opt/mailquota/backups >> /var/log/mailquota-backup.log 2>&1
```

备份包含客户API密钥和账本，限制访问并复制到受控异地存储。保留期限按实际磁盘容量设置，不默认删除历史备份。`.env`和证书单独保存在受控凭据备份中，不写入版本库。

## 恢复

1. 暂停客户邮件操作并停止服务，保留故障现场；不要把恢复旧备份视为可免费恢复额度。
2. 在单独目录解压可信备份，确认含storage/config、storage/templates、storage/data，保留可能存在的WAL；禁止覆盖仍运行的数据。
3. 核查备份时间之后的服务商发送、已用和占用。仍能读取当前账本时优先恢复当前完整账本，不用旧副本覆盖较新计数。若无法完整核查，应继续暂停接单，不能猜测释放占用。
4. 将原storage改名保留，再将已核查的恢复storage放回，设置1000:1000与700权限；先在不对客户开放的环境启动检查配置、用量和历史状态。启动不会补造缺失用量行。
5. 确认ready正常、原请求状态可查、额度四项一致后开放接单。管理员会话重建，客户密钥取决于备份版本；若备份回滚了密钥，开放前重新轮换，避免旧密钥重新有效。

容器验证脚本执行了停服目录快照→容器重建→恢复副本→核查原请求和永久用量的演练。生产从旧备份到当前发送的对账必须由管理员依据真实记录处理，自动脚本不负责猜测差额。

## 版本升级与迁移

SQLite版本用PRAGMA user_version，初始迁移在migrations/001.sql。正常启动只接受支持的版本，绝不清表重建。本版无旧版本升级脚本需求；未来数据库变更增加新的有序迁移，在停服备份后显式执行，保持账本与用量不变。

发布先备份，正常停旧容器，再以新镜像重建；数据挂载保持不变。回退使用兼容数据库结构的旧镜像，不回退客户直连SMTP。客户离线配置编辑必须停服，合法性在启动检查；低于已用+占用的总额度会阻止启动。

## 客户后续切换

客户项目改造不在本次授权范围。后续移除客户SMTP、验证码生成/核验、邮件Redis计数，并接入API；客户保留业务资格判断和本地数据库更新。浏览器业务purpose可以本地保留，但不传给MailQuota。

旧Redis验证码不迁移，切换前可以暂停发送并等待5分钟。真实联调使用隔离测试客户，按正常额度扣量；成功后在阿里云侧轮换曾暴露给客户的旧SMTP凭据。服务故障不能回退本地SMTP或本地验证码。普通密码登录应保持独立可用。
