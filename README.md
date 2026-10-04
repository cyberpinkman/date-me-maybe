# Date Me Maybe · 见一面

[![CI](https://github.com/cyberpinkman/date-me-maybe/actions/workflows/ci.yml/badge.svg)](https://github.com/cyberpinkman/date-me-maybe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-pink.svg)](LICENSE)

把“想见你”做成一份俏皮的小邀请。为暧昧期设计的小海豹、会逃跑的按钮和逐步展开的选择，帮助两个人安排下一次见面。

A playful date invitation app with a shy seal, a runaway “let me think” button, and a scene-by-scene invitation journey. Vanilla JavaScript on the frontend; Express, PostgreSQL, and Better Auth on the backend. The backend edition requires an application server and PostgreSQL; it cannot run as a standalone static page.

<img src="docs/assets/runaway-demo.gif" alt="收邀互动：按钮反复换位并更换文案，愿意按钮保持固定" width="420">

## 当前可以体验什么

- **登录后创建邀请**：填写昵称和邀请语，把具体安排留给对方；从“我的邀约”查看自己的邀请。
- **专属邀请链接**：创建后复制 `/i/:token` 链接，对方无需注册即可打开和回应。
- **完整收邀情境**：专属邀请 → 惊喜回应 → 时间 → 小暗示 → 见面方式 → 具体偏好 → 小约定。
- **由受邀人提议安排**：自行设置时间、地点，多选愿意一起做的活动；餐饮、咖啡、散步、电影、聊天和逛展分别保留具体偏好。
- **发起人敲定活动**：从对方愿意的范围里选一项，形成最终约定。变更时间、地点后需要对方重新确认；约定卡可保存为 PNG。
- **服务端保存**：邀请与回应保存在 PostgreSQL。发起人的列表和详情在可见、空闲时每 15 秒检查更新，也支持手动刷新。

![时间、氛围与餐饮选择](docs/assets/journey-preview.jpg)

本版已接入真实账号、数据库和 HTTP API，邀请记录不再依赖 `localStorage` 或演示用身份切换。创建草稿可暂存在当前标签页的 `sessionStorage`，方便登录后继续；尚未提交的接收端选择仍只保留在当前页面内。

**接收者权限来自链接本身。** 43 字符的随机链接只允许回应对应的那一份邀请，但不验证打开者一定是昵称中的 B。转发链接后，新的持有者也能访问和回应该份邀请。不要把这种能力当作接收者身份认证。

## 本地启动

需要 **Node.js 22.x、npm 和专用 PostgreSQL 数据库**。本地已使用 22.22.3 验收，`engines.node` 固定在 22.x，避免部署平台自动选择不同主版本。后端依赖锁定在 `package-lock.json`；认证使用 Better Auth **1.7.7**。

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

## 发布状态

**v0.2 已发布。** 正式域名首页、邀请链接、健康接口与跳转已验证；生产环境的真实邮箱登录、创建邀请、匿名回应、发起人确认及退出登录均已通过。

当前开发分支新增“受邀人提议安排、发起人敲定活动”的流程，尚未发布至正式站点。旧邀请仍可打开和回应，无需迁移已有记录。

在线使用：[opendater.com](https://opendater.com)。`www.opendater.com` 以 308 跳转到主域名。

| 部分 | 当前发布配置 |
| --- | --- |
| 应用 | 独立 Vercel 项目 `opendater`，Express / Node.js 22，运行区域 `sin1` |
| 数据库 | 独立 Neon Free 数据库 `opendater-db`，区域 `sin1`；仅连接 Production 环境 |
| 登录 | Resend 邮箱验证码；真实投递与生产登录已验证。Google 尚未配置，因此不显示入口 |
| 数据迁移 | Production 构建前从云端敏感变量读取直连地址，经 TLS 验证后迁移；其他环境只构建前端 |
| 部署 | 使用已登录的官方 Vercel CLI；尚未接入 Vercel GitHub App，推送 GitHub 不会自动上线 |
| 回应更新 | 页面每 15 秒检查更新并支持刷新；没有邀约回执邮件或后台推送 |

GitHub `main` 已包含后台实现。Node.js 22 CI 已通过 **34 项单元/边界测试和 14 项真实 PostgreSQL 集成测试**；这不代替正式域名下的上线检查。部署配置、迁移与环境隔离见[后端说明](docs/backend.md#生产部署)。

**旧 v0.1 静态 Release 仅为交互原型。** 当前 `dist/index.html` 与 `public/index.html` 都需要同源后端和数据库；单独发布 HTML 无法提供登录、分享和跨设备回应。

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
docs/backend.md      配置、接口、权限模型及生产部署
docs/assets/         收邀视觉和交互演示素材
```

欢迎通过 Issue 讨论想法，或提交 Pull Request。代码修改请运行相关测试和 `npm run build`；交互与样式修改请附截图或录屏。

## 素材与许可证

小海豹角色图为本项目生成的素材，演示截图来自本项目。交互灵感来自约会邀请演示视频，本仓库独立实现，不包含参考视频、视频截图或原作者素材。

Date Me Maybe · 见一面以 [MIT License](LICENSE) 在[公开仓库](https://github.com/cyberpinkman/date-me-maybe)开源。
