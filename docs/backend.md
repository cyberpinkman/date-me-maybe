# Date Me Maybe · 见一面：后端验收说明

本文对应本地后端验收版。当前运行方式是 Express 提供同源页面与 API、Better Auth 1.7.7 管理发起人登录、PostgreSQL 保存认证数据和邀请状态。本地 `*.test` 验证码、真实会话与邀请 API 已完成集成验收；Resend 真实邮件投递、用户收件回码和本地登录也已验收通过。Google 与公网环境仍需分别验收。

本次没有部署公网服务或修改网站解析。后续域名确定为 `opendater.com`；实际发布和网站 DNS 操作等待用户最终验收。邮件域名验证及专用发送凭据的配置另行进行，不等于网站已上线。

## 本地数据库和配置

使用 Node.js 22+、npm 及独立的 PostgreSQL 实例或开发数据库。开发库和集成测试库必须分开；不要将迁移或测试指向已有业务库。

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

把输出保存在本地 `.env` 或部署平台的服务端环境变量中。`DATABASE_URL`、认证与分享密钥、Google client secret、Resend key 都不能提交到 Git，也不能打包进 `dist/`、`public/`、浏览器脚本或 DOM。仓库只保留不含真实凭证的 `.env.example`。

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
| 计划中的正式域名 | `https://opendater.com` | `https://opendater.com/api/auth/callback/google` |

Google 返回 Better Auth 回调后，应用继续返回 `/?login=complete`；该页面地址不是应登记的 Google redirect URI。若另用 `localhost` 或其他开发端口，需要让 `APP_ORIGIN` 和 OAuth 控制台配置一致。

代码使用 Google 登录的基本身份信息范围，不请求 Gmail 读写权限；当前关闭自动账号关联。仅生成 Google 授权 URL 的测试不能证明真实 OAuth 链路已经完成。

### Resend 真实验证码邮件

真实投递需要先在 Resend 验证可控的发信域名，并按服务商要求配置邮件 DNS 记录；再创建专用、仅允许发送的 API key，设置该域名下的 `EMAIL_FROM`，例如 `见一面 <hello@opendater.com>`。`.env.example` 中的发件人只是配置示例，不能证明该域名已经验证。

当前代码已经接线，opendater.com 已通过 Resend 域名验证；用户已确认创建仅限该域名的发送凭据，并已接入本机服务端环境；已向用户提供的收信地址发送一封真实登录验证码。Resend 显示 Delivered，用户收件后提供验证码，本地应用登录成功，数据库已验证邮箱及有效会话均确认。以上结果来自真实投递与用户回码，不是由单元测试或 DNS 记录存在推断；生产环境仍需在正式 HTTPS 域名下复验。

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
| `POST /api/invitations/:id/actions` | owner 提议或确认，提交 `type`、`version`、`requestId` 与可选 `proposal` |
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

测试结果以当前命令输出为准，不固定声称测试数量。本地代码和集成验收通过，不等于 Google、真实邮件、远程数据库或公网行为已验收。

### 迁移时的已知提示

空数据库第一次运行迁移时，Better Auth 可能先提示认证表缺失，随后迁移会创建这些表。应确认最终输出 `Database migrations applied.`、退出码为 0，再执行健康检查与集成测试；不能只根据前面的缺表提示认定迁移失败。

Better Auth 1.7.7 的迁移检测器还可能对限流表的 `lastRequest` 字段提示 `number` 与 `int8` 不匹配。本地已追查到检测器的 PostgreSQL 数字类型映射包含 `bigint`、遗漏其 `int8` 别名，而迁移生成 `bigint`、PostgreSQL 元数据返回 `int8`。这一已确认条件下属于类型别名识别告警，实际字段仍为 64 位整数；没有修改依赖或将字段降级来消除告警。

此说明仅适用于上述字段和别名组合。其他迁移错误、非零退出码或集成失败仍应根据原始原因诊断，不能一概忽略。

## 后续部署前的已知依赖

部署与网站 DNS 操作须等用户最终验收。Vercel 所需的本地代码已准备，但本次未部署，也没有完成平台行为或 `opendater.com` 的线上服务验证。旧 v0.1 Release 是纯静态原型；单独发布当前 `dist/index.html` 也无法提供账号和邀请 API。

根目录 `app.mjs` 按 [Vercel Express 入口约定](https://vercel.com/docs/frameworks/backend/express)默认导出 Express 应用，在模块初始化时创建一个可复用的 PostgreSQL 连接池，并接入 `@vercel/functions` 的 [`attachDatabasePool`](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#attachdatabasepool)，供平台在实例挂起前管理空闲连接。入口不会监听端口或自动执行迁移；本地仍使用 `server/start.mjs`。

`npm run build` 从同一份前端源码生成内容相同的 `dist/index.html` 和 `public/index.html`。本地 Express 使用前者；Vercel Express 适配器不通过 `express.static()` 提供文件，后者由平台静态资源层提供。`vercel.json` 把 `/i/:token` 重写到该页面，并将隐私与安全响应头应用到静态资源和 API；API 仍由 Express 处理。构建产物不读取服务端环境变量，`public/index.html` 与 `dist/` 均不提交到 Git。

正式环境需要 HTTPS `APP_ORIGIN`、持久 PostgreSQL、服务端随机密钥，并至少配置 Google 或 Resend 登录渠道；生产模式拒绝启用本地邮件箱。Preview 与 Production 的服务端环境变量需分别配置，origin、OAuth 回调与数据库目标须匹配该环境，不从请求 Host 推导。数据库迁移需要单独执行，不能依赖访问页面时自动建表；远程数据库 TLS、连接额度及与函数所在区域的距离仍需按所选数据库服务确认。

认证和匿名邀请的两个限流入口统一使用 `server/client-ip.mjs`：本地从连接 socket 读取；只有服务端环境 `VERCEL=1` 时，才读取 Vercel 平台提供的 `x-vercel-forwarded-for`。地址必须是单个有效 IPv4 或 IPv6；缺失、数组、代理链或非法地址统一使用保守的共享地址值，不回退到请求中的 `X-Forwarded-For`。传给 Better Auth 的 IP 头由服务器覆盖。本地矩阵已覆盖伪造头、平台有效头以及缺失或非法值；这验证了代码分支，实际平台头和代理链仍须上线验收。[Vercel 请求头约定](https://vercel.com/docs/headers/request-headers)

此外还需验收所选运行时对 Express 的适配、数据库连接管理与 Resend 投递；若启用 Google，还需验收真实授权回调，确认日志和构建产物没有泄露服务器凭证。完成这些步骤后，才能将本地验收结论扩展到生产环境。
