# Date Me Maybe · 见一面

[![CI](https://github.com/cyberpinkman/date-me-maybe/actions/workflows/ci.yml/badge.svg)](https://github.com/cyberpinkman/date-me-maybe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-pink.svg)](LICENSE)

把“想见你”做成一份俏皮的小邀请。为暧昧期设计的互动邀约原型，用小海豹、会逃跑的按钮和一步步展开的选择，安排下一次见面。

A playful date invitation prototype with a runaway “let me think” button, a shy seal, and a scene-by-scene invitation journey. Built with vanilla JavaScript, HTML, and CSS. No third-party runtime dependencies.

<img src="docs/assets/runaway-demo.gif" alt="连续追逐实测：按钮反复换位并更换文案，愿意按钮保持固定" width="420">

## 里面有什么

- **制作邀请**：昵称、邀请语、语气、候选时间和活动提议。
- **暧昧小互动**：“让我想想”随鼠标追逐反复逃跑并换文案；手机点按也会触发。“愿意”留在原处，收邀界面没有额外拒绝入口。
- **完整收邀情境**：专属邀请 → 惊喜回应 → 时间 → 小暗示 → 见面方式 → 具体偏好 → 小约定。
- **活动分支**：餐饮九宫格，以及咖啡、散步、电影、聊天、逛展各自的选项。
- **约定卡**：汇总时间、地点、活动与小暗示，生成 PNG 图片。
- **双方视角演示**：切换发起人和接收者，体验确认、补地点、改期及安排更新。

![时间、氛围与餐饮选择](docs/assets/journey-preview.jpg)

## 快速开始

需要 **Node.js 22 或更新版本**及附带的 npm。没有需要安装的第三方依赖。

```bash
git clone https://github.com/cyberpinkman/date-me-maybe.git
cd date-me-maybe
npm start
```

打开 **http://127.0.0.1:3000**，点击顶部的 **“体验收邀”**，即可跳过创建表单直接体验完整流程。

默认端口被占用时，macOS / Linux 可使用：

```bash
PORT=3001 npm start
```

Windows PowerShell 可使用：

```powershell
$env:PORT=3001; npm start
```

## 当前版本的范围

这是 **浏览器本地交互原型**。邀请记录保存在当前浏览器的 `localStorage`，没有后端、账号、真实邀请链接、跨设备回复或消息通知。双方身份切换用于演示，不能当作身份认证。

收邀流程中的选择在当前页面内保留，最终提交后才写入记录；提交前刷新页面会丢失这段选择。清除网站数据也会删除本地邀请记录。

请通过 **localhost 或 HTTPS** 使用，浏览器需要支持 Web Locks、localStorage 与 Canvas。直接双击 HTML 的 `file://` 模式不保证保存功能可用。默认开发服务器只监听本机 `127.0.0.1`。

## 开发与构建

```bash
npm test       # 运行模型、存储并发和按钮交互测试
npm run build  # 生成 dist/index.html
npm start      # 构建并启动本机预览
```

`dist/index.html` 内嵌了脚本、样式和角色图，可以部署到支持 HTTPS 的静态托管服务。静态托管只让页面可访问，并不会自动实现双方数据同步。

```text
src/
  app.js               创建器、双方视角、卡片导出与页面渲染
  journey.js           收邀步骤及尚未提交的选择
  runaway.js           连续逃跑、文案循环与触摸事件处理
  model.js             邀请版本、双方确认及状态转换
  store.js             使用 Web Locks 串行提交本地更改
  style.css            页面与移动端样式
  index.template.html  单页构建模板
assets/                角色图
scripts/               无第三方依赖的构建与本机服务器
tests/                 Node.js 内置测试
docs/assets/           当前原型截图和交互演示
```

修改 `src/` 后重新运行 `npm run build`，再刷新页面。构建产物不提交到源码仓库，可从 [Releases](https://github.com/cyberpinkman/date-me-maybe/releases) 下载。

测试覆盖：同一版本的双方确认、变更使旧确认失效、旧版本提交被拒绝、时间修改保留偏好、活动切换清除旧分支细节、多标签页并发，以及按钮连续位移、边界、文案循环与触摸去重。

## 后续方向

- 可分享的邀请链接与跨设备回应。
- 更多角色、主题和邀约场景。
- 真实发起人 / 接收者权限与通知。

欢迎通过 Issue 讨论想法，或提交 Pull Request。代码修改请运行 `npm test` 和 `npm run build`；交互与样式修改请附上截图或录屏。

## 素材与许可证

小海豹角色图为本项目生成的素材，演示截图来自本项目。交互灵感来自约会邀请演示视频，本仓库独立实现，不包含参考视频、视频截图或原作者素材。

项目以 [MIT License](LICENSE) 开源。
