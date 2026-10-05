# Date Me Maybe · 见一面

[![CI](https://github.com/cyberpinkman/date-me-maybe/actions/workflows/ci.yml/badge.svg)](https://github.com/cyberpinkman/date-me-maybe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-pink.svg)](LICENSE)

把“想见你”做成一份俏皮的小邀请。为暧昧期设计的小海豹、会逃跑的按钮和逐步展开的选择，帮助两个人安排下一次见面。

A playful date invitation app with a shy seal, a runaway “let me think” button, and a scene-by-scene invitation journey. Vanilla JavaScript on the frontend; Express, PostgreSQL, and Better Auth on the backend. The backend edition requires an application server and PostgreSQL; it cannot run as a standalone static page.

<img src="docs/assets/runaway-demo.gif" alt="收邀互动：按钮反复换位并更换文案，愿意按钮保持固定" width="420">

## 当前可以体验什么

- **两种发起方式**：选择“我来安排”或“想听 TA 的”。填写昵称和邀请语，登录后创建；从“我的邀约”查看自己的邀请。
- **专属邀请链接**：创建后复制 `/i/:token` 链接，对方无需注册即可打开和回应。
- **完整收邀情境**：专属邀请 → 惊喜回应 → 时间 → 小暗示 → 见面方式 → 具体偏好 → 小约定。
- **单项安排与可选范围**：时间、地点、活动和每项活动的具体偏好均可提供单项或多个候选。谁提出范围，就由另一方选定；全部唯一时可直接接受。
- **形成最终约定**：选定时间、地点、活动和具体偏好；变更已约好的时间、地点后需要对方重新确认。旧邀请保留原来的确认方式。
- **按空闲时间约见面**：设置每周时段、日期例外和私人忙碌安排；选择“使用我的时间表”后，对方只能选择未来 30 天内适合完整约会时长的时段。默认约会时长两小时，可在创建时调整。
- **日程自动避开冲突**：最终约定才占用时间，改期确认前保留原约定，取消后释放。受邀人可主动把约定加入自己的账号日程，未登录者照常回应。
- **回应后也能发起**：受邀人完成回应后，可从结果页底部进入“我也要发起邀约”，写好自己的邀请再登录。
- **把约定收好**：展示可长按的真实卡片图片；支持文件分享的手机可打开系统分享菜单，也可打开大图或下载 JPEG。
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

## 运营管理后台

本轮已准备独立的运营后台，计划使用 `admin.opendater.com`，通过服务端邮箱许可名单和独立验证码登录查看概览、注册与邀约趋势、用户详情及邀约列表。业务数据接口只读，前台登录不会自动获得后台权限。**v0.6.0 已在本地准备，尚待生产部署与验收。** 配置、认证隔离及域名路由见[运营后台说明](docs/operations-admin.md)，统计定义见[运营数据契约](docs/admin-data-contract.md)。

## 发布状态

**v0.6.0 运营后台正在准备发布。** 本地 81 项单元/边界测试、48 项真实 PostgreSQL 集成测试通过，后台验证码登录及数据页已完成本地浏览器验收。生产结果尚未确认；下文保留已发布 v0.5.0 的记录。

**v0.5.0 已于 2026-10-05 发布。** 新增个人时间表、未来 30 天可选时段、默认两小时约会、私人忙碌安排和主动绑定受邀日程。候选时间不占用日程，最终确认才占用；改期确认前保留原约定，取消后释放。规则、数据库迁移与匿名身份边界见[日程管理说明](docs/scheduling.md)。

线上已完成真实邮箱登录、时间表保存、匿名多候选回应、最终确认、跨邀约排除重叠时段和取消释放的验证。两份本轮测试邀约均已取消，临时开放时段已移除；历史约定保留，旧版存在的重叠记录会提示调整。主动绑定受邀人及并发竞争由真实 PostgreSQL 集成测试覆盖，本轮未使用第二个正式账号重复绑定验证。

正式首页与发布构建逐字节一致，数据库健康检查正常，`www` 跳转及微信验证文件保持正确，生产测试邮箱关闭；本轮部署未查询到运行时错误日志。双向邀约与图片卡片沿用 v0.4.0，合同见[双向邀约说明](docs/invitation-modes.md)。手机相册保存仍需真机核对，不能由桌面手机视口测试代替。

在线使用：[opendater.com](https://opendater.com)。`www.opendater.com` 以 308 跳转到主域名。

| 部分 | 当前发布配置 |
| --- | --- |
| 应用 | 独立 Vercel 项目 `opendater`，Express / Node.js 22，运行区域 `sin1` |
| 数据库 | 独立 Neon Free 数据库 `opendater-db`，区域 `sin1`；仅连接 Production 环境 |
| 登录 | Resend 邮箱验证码；真实投递与生产登录已验证。Google 尚未配置，因此不显示入口 |
| 数据迁移 | Production 构建前从云端敏感变量读取直连地址，经 TLS 验证后迁移；其他环境只构建前端 |
| 部署 | 使用已登录的官方 Vercel CLI；尚未接入 Vercel GitHub App，推送 GitHub 不会自动上线 |
| 回应更新 | 页面每 15 秒检查更新并支持刷新；没有邀约回执邮件或后台推送 |

GitHub `main` 已同步 v0.5.0 实现，[v0.5.0 Release](https://github.com/cyberpinkman/date-me-maybe/releases/tag/v0.5.0) 对应生产部署。发布提交 `007e789` 的 [Node.js 22 CI](https://github.com/cyberpinkman/date-me-maybe/actions/runs/37267310466) 已通过 **80 项单元/边界测试、35 项真实 PostgreSQL 集成测试及构建**。部署配置、迁移与环境隔离见[后端说明](docs/backend.md#生产部署)。

**旧 v0.1 静态 Release 仅为交互原型。** 当前 `dist/index.html` 与 `public/app.html` 都需要同源后端和数据库；单独发布 HTML 无法提供登录、分享和跨设备回应。

## 开发与验证

```bash
npm test                 # 模型、交互、认证配置、客户端 IP 和 HTTP 边界测试
npm run build            # 生成主站和运营后台文档，Vercel 主站使用 public/app.html
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
docs/operations-admin.md 运营后台配置、权限与部署
docs/assets/         收邀视觉和交互演示素材
```

欢迎通过 Issue 讨论想法，或提交 Pull Request。代码修改请运行相关测试和 `npm run build`；交互与样式修改请附截图或录屏。

## 素材与许可证

小海豹角色图为本项目生成的素材，演示截图来自本项目。交互灵感来自约会邀请演示视频，本仓库独立实现，不包含参考视频、视频截图或原作者素材。

Date Me Maybe · 见一面以 [MIT License](LICENSE) 在[公开仓库](https://github.com/cyberpinkman/date-me-maybe)开源。
