# Date Me Maybe · 见一面

[![CI](https://github.com/cyberpinkman/date-me-maybe/actions/workflows/ci.yml/badge.svg)](https://github.com/cyberpinkman/date-me-maybe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-pink.svg)](LICENSE)

把“想见你”做成一份俏皮的小邀请。为暧昧期设计的小海豹、会逃跑的按钮和逐步展开的选择，帮助两个人安排下一次见面。

A playful date invitation app with a shy seal, a runaway “let me think” button, and a scene-by-scene invitation journey. Vanilla JavaScript on the frontend; Express, PostgreSQL, and Better Auth on the backend. This branch is a local backend acceptance build, not a production deployment.

<img src="docs/assets/runaway-demo.gif" alt="收邀互动：按钮反复换位并更换文案，愿意按钮保持固定" width="420">

## 当前可以体验什么

- **登录后创建邀请**：昵称、邀请语、候选时间和活动提议；从“我的邀约”查看自己的邀请。
- **专属邀请链接**：创建后复制 `/i/:token` 链接，对方无需注册即可打开和回应。
- **完整收邀情境**：专属邀请 → 惊喜回应 → 时间 → 小暗示 → 见面方式 → 具体偏好 → 小约定。
- **活动分支**：餐饮九宫格，以及咖啡、散步、电影、聊天、逛展各自的选项。
- **双方确认与改期**：变更安排后重新确认；修改时间、地点时保留已选偏好；约定卡可保存为 PNG。
- **服务端保存**：邀请与回应保存在 PostgreSQL。发起人的列表和详情在可见、空闲时每 15 秒检查更新，也支持手动刷新。

![时间、氛围与餐饮选择](docs/assets/journey-preview.jpg)

本版已接入真实账号、数据库和 HTTP API，邀请记录不再依赖 `localStorage` 或演示用身份切换。创建草稿可暂存在当前标签页的 `sessionStorage`，方便登录后继续；尚未提交的接收端选择仍只保留在当前页面内。

**接收者权限来自链接本身。** 43 字符的随机链接只允许回应对应的那一份邀请，但不验证打开者一定是昵称中的 B。转发链接后，新的持有者也能访问和回应该份邀请。不要把这种能力当作接收者身份认证。

## 本地启动

需要 **Node.js 22+、npm 和专用 PostgreSQL 数据库**。后端依赖锁定在 `package-lock.json`；认证使用 Better Auth **1.7.7**。

```bash
git clone https://github.com/cyberpinkman/date-me-maybe.git
cd date-me-maybe
npm ci
cp .env.example .env
```

先按[后端说明](docs/backend.md#本地数据库和配置)创建独立数据库用户与开发数据库，再修改 `.env`：

```dotenv
NODE_ENV=development
PORT=3010
APP_ORIGIN=http://127.0.0.1:3010
DATABASE_URL=postgres://date_me_maybe:URL_ENCODED_PASSWORD@127.0.0.1:65500/date_me_maybe
DEV_MAILBOX=1
```

上面的密码是占位符；端口需匹配你专门准备的 PostgreSQL 实例。不要直接沿用 `.env.example` 中的示例账号、密码或连接到其他项目的数据库。

为 `AUTH_SECRET` 和 `SHARE_TOKEN_SECRET` **分别生成随机值**，填入 `.env`：

```bash
node -e "for (const key of ['AUTH_SECRET','SHARE_TOKEN_SECRET']) console.log(key+'='+require('node:crypto').randomBytes(32).toString('hex'))"
npm run db:migrate
npm start
```

打开 [http://127.0.0.1:3010](http://127.0.0.1:3010)。本地登录可用 `a@example.test` 或 `c@example.test`，点击登录页的“本地测试邮件箱”读取验证码；不会向真实邮箱发邮件。创建邀请后，在另一浏览器窗口打开生成的链接体验接收流程。

`DEV_MAILBOX=1` 仅允许回环地址访问，因此当前本地链接适用于同一台电脑上的验收。跨设备使用需要后续配置可访问的服务地址和真实登录渠道。

## 已接入与待验收

| 能力 | 当前状态 |
| --- | --- |
| 邮箱验证码、会话、邀请隔离 | 已通过本地真实 PostgreSQL + HTTP 集成验收；邮箱使用 `*.test` 邮件箱 |
| Google 登录 | 已接线并支持配置；尚无真实 OAuth 凭证，未完成真实 Google 登录验收 |
| Resend 邮件 | opendater.com 已通过 Resend 域名验证；专用发送凭据待确认创建，真实邮件登录待验收 |
| 邀请回应更新 | 页面每 15 秒轮询及手动刷新；没有邮件回执或后台推送通知 |
| Vercel 运行适配 | Express 入口、静态页面路由、连接池管理与平台 IP 读取已准备；尚未部署或完成平台验收 |
| 公网服务 | 本次未部署；后续域名已选定为 `opendater.com`，发布及网站 DNS 操作等待用户最终验收 |

旧 **v0.1 静态 Release 仅为交互原型**。当前构建的 `dist/index.html` 需要同源后端和数据库；单独放到静态托管上不构成这套后端应用。

## 开发与验证

```bash
npm test                 # 模型、交互、认证配置、客户端 IP 和 HTTP 边界测试
npm run build            # 生成相同内容的 dist/index.html 和 public/index.html
npm run db:migrate       # Better Auth 表及应用数据库迁移
npm start                # 构建前端并启动 Express，默认 3010
```

真实集成测试使用**单独的测试数据库**：

```bash
TEST_DATABASE_URL='postgres://date_me_maybe:URL_ENCODED_PASSWORD@127.0.0.1:65500/date_me_maybe_test' npm run test:integration
```

测试只接受回环地址、专用 `date_me_maybe_test` 库和端口 `65500` 或 `55439`，不会使用 5432 或回退读取开发 `DATABASE_URL`。未设置 `TEST_DATABASE_URL` 时会明确跳过。测试不重置数据库，真实 OTP 限流仍然生效，短时间重复运行可能需要等待限流窗口。

覆盖重点包括 owner 权限隔离、匿名邀请边界、版本冲突、并发提交、幂等响应、验证码错误与重放、退出后会话失效。以测试输出为准；本地测试通过不代表生产环境或外部服务已验收。

```text
src/                 创建器、登录、收邀流程、API 客户端与卡片导出
server/              Express API、Better Auth、邮件、数据库与邀请服务
db/migrations/       应用 PostgreSQL 迁移
scripts/             前端构建与数据库迁移入口
app.mjs              Vercel Express 入口；本地仍使用 server/start.mjs
vercel.json          Vercel 构建、邀请页面路由与安全响应头
tests/               单元、HTTP 边界及真实数据库集成测试
docs/backend.md      配置、接口、权限模型及上线前依赖
docs/assets/         收邀视觉和交互演示素材
```

欢迎通过 Issue 讨论想法，或提交 Pull Request。代码修改请运行相关测试和 `npm run build`；交互与样式修改请附截图或录屏。

## 素材与许可证

小海豹角色图为本项目生成的素材，演示截图来自本项目。交互灵感来自约会邀请演示视频，本仓库独立实现，不包含参考视频、视频截图或原作者素材。

Date Me Maybe · 见一面以 [MIT License](LICENSE) 在[公开仓库](https://github.com/cyberpinkman/date-me-maybe)开源。
