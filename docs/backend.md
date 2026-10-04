# Date Me Maybe · 见一面：后端与部署

本文对应 v0.3 后台版：Express 提供同源页面与 API，Better Auth 1.7.7 管理发起人登录，PostgreSQL 保存认证数据和邀请状态。发起人登录后创建和管理邀请，受邀人通过专属链接免登录回应。

本地 HTTP、真实 PostgreSQL 集成及 Resend 邮件登录已验收；用户已批准生产发布。[当前发布进度见 README](../README.md#发布状态)。Google 尚未配置，不属于这次上线的登录方式。

## 本地数据库和配置

使用 Node.js 22.x、npm 及独立的 PostgreSQL 实例或开发数据库。本地验收使用 22.22.3，`package.json` 与 lockfile 固定在 22.x，部署平台仅在该主版本内更新。开发库和集成测试库必须分开；不要将迁移或测试指向已有业务库。

以下示例假定已经有一台专用 PostgreSQL 实例监听 `127.0.0.1:65500`。使用该实例的管理员连接 `postgres` 库，在 `psql` 中执行：

```sql
CREATE ROLE date_me_maybe LOGIN;
\password date_me_maybe
CREATE DATABASE date_me_maybe OWNER date_me_maybe;
CREATE DATABASE date_me_maybe_test OWNER date_me_maybe;
```

`\password` 交互设置密码，避免把真实密码写进 SQL 文件。上述角色只用于此项目，不需要授予超级用户权限。若角色或数据库已经存在，应检查现有归属并复用专用资源，不要删除已有数据后重建。

```bash
npm ci
cp .env.example .env
```

编辑 `.env` 中的连接、origin 和密钥。数据库连接密码若包含 URL 保留字符，需要做百分号编码。

| 变量 | 本地用途 |
| --- | --- |
| `NODE_ENV` | `development`；生产才设为 `production` |
| `PORT` | Express 端口，默认 `3010` |
| `APP_ORIGIN` | `http://127.0.0.1:3010`，只含协议、主机及端口，不含路径或查询参数 |
| `DATABASE_URL` | 开发库连接，例如 `postgres://date_me_maybe:URL_ENCODED_PASSWORD@127.0.0.1:65500/date_me_maybe` |
| `AUTH_SECRET` | Better Auth 随机密钥，至少 32 字符 |
| `SHARE_TOKEN_SECRET` | 邀请链接加密密钥，至少 32 字符；单独生成 |
| `DEV_MAILBOX` | 本地验收设为 `1`，只接受 `*.test` 邮箱且不投递外部邮件 |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | 可选，必须一起配置；本次未配置真实凭证 |
| `RESEND_API_KEY`、`EMAIL_FROM` | 真实验证码投递需要专用发送凭据和已验证域名下的发件人 |

生成两个不同的随机密钥：

```bash
node -e "for (const key of ['AUTH_SECRET','SHARE_TOKEN_SECRET']) console.log(key+'='+require('node:crypto').randomBytes(32).toString('hex'))"
```

把输出保存在本地 `.env` 或部署平台的服务端环境变量中。`DATABASE_URL`、认证与分享密钥、Google client secret、Resend key 都不能提交到 Git，也不能打包进 `dist/`、`public/`、浏览器脚本或 DOM。`.env`、`.env.production`、`.env.cloud` 均被 Git 和部署上传规则排除；仓库只保留不含真实凭证的 `.env.example`。

`SHARE_TOKEN_SECRET` 用于恢复发起人的既有分享链接，直接替换会导致旧记录无法解密；后续轮换需要设计数据迁移。配置代码允许缺省时沿用 `AUTH_SECRET`，本项目的设置流程要求显式提供两个独立值。

```bash
npm run db:migrate
npm start
```

`db:migrate` 先应用固定版本 Better Auth 的认证表迁移，再按文件名执行 `db/migrations/*.sql`。迁移使用数据库锁并记录文件摘要；已经应用的 SQL 文件不能修改，应新增迁移。`npm start` 构建前端并启动服务，不会自动替你执行迁移。

本地入口是 [http://127.0.0.1:3010](http://127.0.0.1:3010)，`GET /api/health` 会查询数据库并返回服务状态。改 HTTP 端口时，同时更新 `PORT` 和 `APP_ORIGIN`。

## 登录与邮件

### 本地验收邮件箱

`DEV_MAILBOX=1` 时，登录页可使用 `a@example.test`、`c@example.test`，从“本地测试邮件箱”查看验证码。邮箱仅在进程内短期保留测试消息，不会发送真实邮件。

此模式只允许非生产、回环 `APP_ORIGIN`，HTTP 服务也只监听本机。`/api/dev/mailbox` 仅在该模式挂载，服务在入口检查连接来自回环地址。不要通过隧道或转发将本地邮件箱对外暴露。

验证码由真实 Better Auth 生成和校验，有效期 5 分钟、最多尝试 5 次；数据库保存哈希。发码接口每 IP 每分钟最多 3 次。错误和已使用验证码不会创建会话；退出会撤销服务端会话，客户端旧 cookie 不应继续获得 owner 权限。

### Google OAuth

设置 `GOOGLE_CLIENT_ID` 与 `GOOGLE_CLIENT_SECRET` 后，登录页才显示 Google 入口。真实 OAuth 凭证、用户授权与回调尚未验收。

配置 Google Web OAuth 客户端时，origin 与 redirect URI 必须对应实际环境：

| 环境 | 应用 origin | Google 授权回调 URI |
| --- | --- | --- |
| 本地 | `http://127.0.0.1:3010` | `http://127.0.0.1:3010/api/auth/callback/google` |
| 正式域名（启用 Google 时） | `https://opendater.com` | `https://opendater.com/api/auth/callback/google` |

Google 返回 Better Auth 回调后，应用继续返回 `/?login=complete`；该页面地址不是应登记的 Google redirect URI。若另用 `localhost` 或其他开发端口，需要让 `APP_ORIGIN` 和 OAuth 控制台配置一致。

代码使用 Google 登录的基本身份信息范围，不请求 Gmail 读写权限；当前关闭自动账号关联。仅生成 Google 授权 URL 的测试不能证明真实 OAuth 链路已经完成。

### Resend 真实验证码邮件

真实投递需要先在 Resend 验证可控的发信域名，并按服务商要求配置邮件 DNS 记录；再创建专用、仅允许发送的 API key，设置该域名下的 `EMAIL_FROM`，例如 `见一面 <hello@opendater.com>`。`.env.example` 中的发件人只是配置示例，不能证明该域名已经验证。

`opendater.com` 已通过 Resend 域名验证，专用发送凭据仅限该域名。已完成真实邮件投递、用户收件回码及本地登录验证；正式站点使用同一邮箱验证码流程，生产结果以正式 HTTPS 域名下的检查为准。

使用真实邮件时将 `DEV_MAILBOX` 设为 `0`，填写 `RESEND_API_KEY` 与有效 `EMAIL_FROM`。邮件 DNS 变更与网站解析独立，不会使 `opendater.com` 的网站自动上线。

邮件能力目前只服务于登录验证码。邀请的发送由用户复制链接后自行分享，**没有邀约回执邮件、定时提醒或后台推送通知**。

## 数据和权限边界

### 发起人账户

发起人必须有 Better Auth 的已验证邮箱会话才能创建、列出和管理邀请。后端从会话推导 `ownerId`，使用带 `owner_id` 的 SQL 查询和变更语句隔离记录；并非依赖前端列表过滤，也没有使用 PostgreSQL RLS 策略。

另一位登录用户按邀请 ID 查询或修改不属于自己的邀请，返回 404。客户端不得提交 `role`、`ownerId` 等身份字段；这些字段会被拒绝，角色由访问入口决定。浏览器没有“切换成发起人/接收者”的授权机制。

### 匿名接收者

分享链接为 `/i/<43字符base64url token>`，token 来自 32 个随机字节。数据库按 token 的 SHA-256 摘要定位邀请；原 token 使用服务端密钥加密保存，以便发起人再次复制链接。

持有链接即可读取和回应该份邀请，无需登录。链接是单份邀请的访问能力，**不能验证持有者就是 B，也不会阻止 B 转发链接**。当前没有接收者实名验证、链接过期或主动撤销/轮换入口。

接收端响应不会包含 owner ID、owner 邮箱、数据库 token 摘要、加密 token、密钥或发起人的 `shareUrl` 字段。邀请内用户主动填写的昵称、邀请语、地点和安排属于接收端可见内容。

### 版本、确认和重试

每次提交携带展示时的 `version` 与 UUID `requestId`。服务端在同一事务内完成权限查询、行锁、版本检查、状态转换和提交日志写入。对同一旧版本的两个并发修改，只有一个能提交；过期版本返回 409。

相同操作的重试复用 `requestId`，避免丢失 HTTP 响应后重复推进状态；同一个键对应不同内容会返回 409。幂等回归还覆盖后续操作已推进状态时，旧 action 重放返回首次响应快照及其时间戳，并保持最新记录不变。

正式约定要求双方同意同一版本，且时间、地点完整。改期会使旧确认失效。小暗示不会重写正式时间；修改日期、时间或地点会保留活动偏好；切换活动时清除不属于新活动的旧细节。

v0.3 增加 `mode: "open"`：发起人不预设安排，受邀人提交未来的日期、时间、非空地点，以及 `proposal.activities` 表示的可接受活动范围。每项偏好保存在 `preferences.details[activity]`；`proposal.activity` 在发起人选定前为空。范围不是已确认的行程，即使只选一项，也要等待发起人敲定。

发起人通过 `finalize` 提交 `{ activity }`，只能选范围中的一项，不能同时修改其他安排。受邀人已同意该范围和时间地点，因此这一步形成双方同意的新版本。普通 `confirm` 不能绕过活动选择；若发起人同时变更时间或地点，则使用 `propose`，并等待受邀人确认。活动范围和对应偏好不能由发起人改写。

邀请状态仍保存在现有 JSONB 字段，不需要 SQL 迁移。旧 `fixed` / `flexible` 记录和未包含 `activities` 的回应保留原有确认行为；旧链接也能通过新版页面提交活动范围。业务规则错误由共享模型的 `RuleError` 映射成明确的 4xx，未识别的程序错误仍保留服务端诊断。

创建记录与已提交回应保存在 PostgreSQL。`sessionStorage` 仅暂存登录前后的创建草稿；接收者尚未提交的分步选择在页面内存中，刷新页面会丢失。

## HTTP 接口

| 接口 | 身份与用途 |
| --- | --- |
| `GET /api/config` | 可用登录方式、origin、本地邮件箱标志，无密钥 |
| `GET /api/session` | 当前账户的基本字段或 `user: null` |
| `GET /api/health` | 数据库可达性 |
| `POST /api/auth/email-otp/send-verification-otp` | 请求登录验证码 |
| `POST /api/auth/sign-in/email-otp` | 邮箱与验证码登录 |
| `POST /api/auth/sign-in/social` | 已配置时启动 Google 登录 |
| `POST /api/auth/sign-out` | 退出当前会话 |
| `GET /api/invitations` | 已登录 owner 的邀请列表 |
| `POST /api/invitations` | 已登录 owner 创建邀请，提交 `draft` 与 `requestId` |
| `GET /api/invitations/:id` | owner 获取一份邀请及分享链接 |
| `POST /api/invitations/:id/actions` | owner `propose`、`confirm` 或 `finalize`，提交 `type`、`version`、`requestId` 与可选 `proposal` |
| `GET /api/guest/:token` | 匿名读取对应邀请 |
| `POST /api/guest/:token/actions` | 匿名 `respond`、`propose` 或 `confirm` |
| `GET /api/dev/mailbox` | 仅本地验收模式提供测试邮件箱 |

修改请求要求 JSON，且 `Origin` 必须等于 `APP_ORIGIN`；跨源请求返回 403。应用 API 错误使用 `{ error: { code, message }, requestId }`，主要错误包括未登录 401、找不到或无权访问 404、版本/幂等冲突 409、输入不合法 422 和限流 429。Better Auth 接口另有其自己的错误 JSON 格式。

发起人列表、详情及接收结果页在可见且没有编辑/弹窗操作时，每 15 秒读取最新状态。未提交的收邀过程不会被轮询打断。这是页面轮询，不是实时推送或后台通知。

## 验证命令与边界

```bash
npm test
npm run build
TEST_DATABASE_URL='postgres://date_me_maybe:URL_ENCODED_PASSWORD@127.0.0.1:65500/date_me_maybe_test' npm run test:integration
```

`npm test` 包括邀请模型、按钮交互、认证配置、邮件、客户端 IP 可信边界和 HTTP 认证边界测试。独立的集成套件使用真实 PostgreSQL、Express HTTP、Better Auth、邮箱验证码和各用户独立 cookie，不模拟邀请持久化。

集成测试仅允许回环地址、库名 `date_me_maybe_test`、端口 `65500` 或此前预留的 `55439`，不访问 5432、不回退读取 `DATABASE_URL`、不删除表或重置库。未设置 `TEST_DATABASE_URL` 时会明确跳过。套件串行组织验收，仅在测试并发不变量时并发提交，并在结束时关闭 HTTP 服务和连接池。

测试覆盖 A/C 两个登录账户及 B/D 两份匿名邀请、越权请求不改变数据、伪造身份字段、无效 token、同版本竞争、幂等完整响应、过期确认、跨源请求、OTP 错误/重放及退出后的旧 cookie。重复运行会保留之前的记录和真实限流状态；每轮只给 A/C 各发一次码，紧接着重跑可能需要等待发码窗口恢复。

v0.3 发布提交 `ffcfd65` 的 Node.js 22 CI，48 项单元/边界测试和 16 项真实 PostgreSQL 集成测试通过。后续修改仍以当前测试输出为准；这些结果不代替正式域名、远程数据库与实际邮件登录的上线检查。

### 迁移时的已知提示

空数据库第一次运行迁移时，Better Auth 可能先提示认证表缺失，随后迁移会创建这些表。应确认最终输出 `Database migrations applied.`、退出码为 0，再执行健康检查与集成测试；不能只根据前面的缺表提示认定迁移失败。

Better Auth 1.7.7 的迁移检测器还可能对限流表的 `lastRequest` 字段提示 `number` 与 `int8` 不匹配。本地已追查到检测器的 PostgreSQL 数字类型映射包含 `bigint`、遗漏其 `int8` 别名，而迁移生成 `bigint`、PostgreSQL 元数据返回 `int8`。这一已确认条件下属于类型别名识别告警，实际字段仍为 64 位整数；没有修改依赖或将字段降级来消除告警。

此说明仅适用于上述字段和别名组合。其他迁移错误、非零退出码或集成失败仍应根据原始原因诊断，不能一概忽略。

## 生产部署

当前部署使用独立 Vercel 项目 `opendater`、新加坡 `sin1` 运行区域，以及同区域的 Neon Free `opendater-db`。数据库仅连接该项目的 **Production** 环境，不与其他项目或 Preview 共用。正式 origin 为 `https://opendater.com`；`www.opendater.com` 以 308 跳转到主域名。

### 环境变量与迁移

| 变量 | Production 用途 |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_ORIGIN` | `https://opendater.com`；登录、分享链接与请求来源检查使用同一 origin |
| `DATABASE_URL` | Neon 提供的应用连接，供运行时连接池使用 |
| `DATABASE_URL_UNPOOLED` | Neon 提供的直连地址，作为敏感变量仅供生产迁移读取 |
| `AUTH_SECRET`、`SHARE_TOKEN_SECRET` | 两个独立随机值，不提交到 Git 或前端产物 |
| `RESEND_API_KEY`、`EMAIL_FROM` | 专用发送凭据及已验证发件人，例如 `见一面 <hello@opendater.com>` |
| `DEV_MAILBOX` | 关闭；生产配置禁止启用本地测试邮件箱 |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | 本次不配置；将来启用时必须同时设置并验收回调 |

`vercel.json` 的构建命令仅在 `VERCEL_ENV=production` 时运行 `scripts/migrate-production.mjs`，成功后再执行 `npm run build`；其他环境只构建前端。

生产迁移脚本要求 `NODE_ENV=production`，从 `DATABASE_URL_UNPOOLED` 读取直连地址，拒绝 pooled 主机，强制 `sslmode=verify-full` 并确认当前数据库连接启用 TLS，再执行认证表和应用表迁移。稳定的直连会话用于维持迁移锁；应用运行时仍使用平台配置的连接池地址。迁移失败会使构建停止，不需要等用户访问页面后才建表。

直连凭据保留在云平台的敏感环境变量中：部署不需要将其导出到本地，也不需要在本地解密生产密钥。不要把 `.env.production`、`.env.cloud` 或凭据导出文件加入 Git。Preview 若以后需要登录与数据库，必须另外配置独立数据库、密钥和匹配的 origin；目前的生产数据库不自动供 Preview 使用。

### 运行和发布方式

根目录 `app.mjs` 按 [Vercel Express 入口约定](https://vercel.com/docs/frameworks/backend/express)默认导出 Express 应用，复用 PostgreSQL 连接池，并接入 [`attachDatabasePool`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#attachdatabasepool) 管理实例挂起前的空闲连接。入口不监听本地端口，也不执行迁移；本地仍使用 `server/start.mjs`。

`npm run build` 生成内容一致的 `dist/index.html` 和 `public/index.html`。本地 Express 使用前者，Vercel 静态资源层提供后者；`/i/:token` 重写到邀请页面，API 由 Express 处理。构建不读取服务端密钥，产物不提交到 Git。**仅托管 HTML 无法运行后台版。**

当前未安装或接入 Vercel GitHub App，使用已登录的官方 Vercel CLI 发布。GitHub 推送只更新代码和运行 CI，不会触发站点部署。

```bash
vercel deploy --dry --format=json  # 先核对上传文件清单
vercel deploy --prod               # 明确发布到 Production
```

发布前确认 CLI 绑定的是此项目，并检查上传清单；`.vercelignore` 排除本地环境文件、密钥和测试输出，保留 `.env.example` 及构建需要的文件。不要只依据 `.gitignore` 判断上传范围。

### 上线检查

正式部署后，检查 `/api/health`、主域名 HTTPS、`www` 跳转、登录验证码真实投递、登录后邀约列表、跨设备邀请回应及双方确认。还要确认本地测试邮件箱不可见、日志和前端产物不含凭据。完成这些检查后，才能将本地验收结论扩展为生产行为验证；当前结果统一记录在 [README 发布状态](../README.md#发布状态)。

认证和匿名邀请限流统一使用 `server/client-ip.mjs`：本地读取连接 socket；只有服务端 `VERCEL=1` 时读取平台提供的 `x-vercel-forwarded-for`。地址必须是单个有效 IPv4 或 IPv6；缺失、数组、代理链或非法地址使用保守的共享值，不回退信任客户端 `X-Forwarded-For`。传给 Better Auth 的 IP 头由服务器覆盖。相关边界已纳入 CI，实际平台头仍须在部署环境确认。[Vercel 请求头约定](https://vercel.com/docs/headers/request-headers)
