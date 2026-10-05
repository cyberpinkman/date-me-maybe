(() => {
  'use strict';

  const root = document.getElementById('admin-root');
  const icons = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
    invites: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
    check: '<path d="m5 12 4 4L19 6"/><circle cx="12" cy="12" r="9"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18m-13 5h2m4 0h2"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6m-5 4a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.overview}</svg>`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const number = (value) => new Intl.NumberFormat('zh-CN').format(count(value));
  const percent = (value, total) => count(total) ? `${Math.min(100, count(value) / count(total) * 100).toFixed(1)}%` : '—';
  const dateTime = (value, short = false) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: short ? undefined : 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  };
  const statusLabels = { waiting: '等待回应', host_review: '待发起人确认', guest_review: '待受邀人确认', confirmed: '已敲定', details: '商量细节中', cancelled: '已取消', declined: '未成行' };
  const modeLabels = { open: '由受邀人选择', host: '由发起人安排', fixed: '发起人指定', flexible: '发起人给范围' };
  const titles = { overview: '数据概览', users: '用户管理', invitations: '邀约记录' };
  const state = {
    user: null, view: 'overview', days: 30, data: null, loading: false, error: '', updatedAt: null,
    users: { page: 1, pageSize: 20, search: '', hasInvitations: '' },
    invitations: { page: 1, pageSize: 20, search: '', status: '', mode: '' },
    login: { email: '', otpSent: false, busy: false, error: '', retryAt: 0 },
    drawer: null,
  };
  let loadSequence = 0;
  let drawerSequence = 0;
  let restoreFocus = null;
  let cooldownTimer = null;

  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      const error = new Error(data.error?.message || data.message || '暂时无法读取，请稍后重试。');
      error.status = response.status;
      error.code = data.error?.code || data.code;
      throw error;
    }
    return data;
  }
  const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) });
  const brand = () => '<span class="brand-mark" aria-hidden="true">♡</span><span><span class="brand-name">见一面</span><span class="brand-caption">OPENDATER · ADMIN</span></span>';

  function renderLogin() {
    const login = state.login;
    root.innerHTML = `<main class="login-page">
      <section class="login-brand-pane"><a class="brand" href="https://opendater.com" target="_blank" rel="noopener noreferrer">${brand()}</a>
        <div class="login-story"><div class="eyebrow">EVERY INVITATION COUNTS</div><h1>让每一份心意，<br>都走向见面。</h1><p>了解用户的到来，观察邀约的进展。<br>在这里，看见产品一点点长大。</p></div>
        <footer>OPENDATER · 运营工作台</footer>
      </section>
      <section class="login-form-pane"><div class="login-card"><div class="eyebrow">WELCOME BACK</div><h2>${login.otpSent ? '查收你的验证码' : '登录运营后台'}</h2>
        <p class="intro">${login.otpSent ? '输入邮件中的 6 位验证码，继续查看数据。' : '使用管理员邮箱，安全查看用户与邀约数据。'}</p>
        ${login.error ? `<div class="login-alert" role="alert">${esc(login.error)}</div>` : ''}
        ${login.otpSent ? `<p class="login-mail">验证码已发送至 <strong>${esc(login.email)}</strong></p>` : ''}
        <form id="login-form">
          ${login.otpSent ? '<div class="field"><label for="login-otp">邮箱验证码</label><input id="login-otp" name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码" required autofocus /></div>' : `<div class="field"><label for="login-email">管理员邮箱</label><input id="login-email" name="email" type="email" autocomplete="email" placeholder="输入你的邮箱" value="${esc(login.email)}" maxlength="254" required autofocus /></div>`}
          <button class="button primary" type="submit" ${login.busy ? 'disabled' : ''}>${login.busy ? '正在处理…' : login.otpSent ? '登录后台' : '发送验证码'}</button>
        </form>
        ${login.otpSent ? `<div class="login-secondary"><button class="text-button" data-action="change-email" ${login.busy ? 'disabled' : ''}>更换邮箱</button><button class="text-button" data-action="resend" ${login.busy || login.retryAt > Date.now() ? 'disabled' : ''}>重新发送</button></div>` : ''}
        <p class="login-notice">仅授权管理员可访问。验证码用于确认身份，请勿转发给他人。</p>
      </div></section></main>`;
    updateCooldown();
  }

  function updateCooldown() {
    const button = root.querySelector('[data-action="resend"]');
    if (button) {
      const seconds = Math.max(0, Math.ceil((state.login.retryAt - Date.now()) / 1000));
      button.textContent = seconds ? `${seconds} 秒后重新发送` : '重新发送';
      button.disabled = Boolean(seconds || state.login.busy);
    }
    if (state.login.retryAt <= Date.now() && cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
  }

  async function sendCode(email) {
    state.login.email = email.trim();
    state.login.busy = true;
    state.login.error = '';
    renderLogin();
    try {
      await post('/api/admin/auth/email-otp/send-verification-otp', { email: state.login.email, type: 'sign-in' });
      state.login.otpSent = true;
      state.login.retryAt = Date.now() + 60000;
      clearInterval(cooldownTimer);
      cooldownTimer = setInterval(updateCooldown, 1000);
    } catch (error) { state.login.error = error.message; }
    state.login.busy = false;
    renderLogin();
    root.querySelector(state.login.otpSent ? '#login-otp' : '#login-email')?.focus();
  }

  async function signIn(otp) {
    state.login.busy = true;
    state.login.error = '';
    renderLogin();
    try {
      await post('/api/admin/auth/sign-in/email-otp', { email: state.login.email, otp });
      const session = await request('/api/admin/session');
      if (!session.user) throw new Error('这个账户暂时无法访问运营后台。');
      state.user = session.user;
      state.login.busy = false;
      clearInterval(cooldownTimer);
      cooldownTimer = null;
      await loadPage();
      return;
    } catch (error) { state.login.error = error.message; }
    state.login.busy = false;
    renderLogin();
    root.querySelector('#login-otp')?.focus();
  }

  function header() {
    const descriptions = { overview: '从一次邀请，到真正见面。', users: '了解谁在使用见一面，以及他们的邀约进展。', invitations: '查看每份邀约走到了哪一步。' };
    return `<div class="page-heading"><div><div class="eyebrow">${state.view === 'overview' ? 'THE BIG PICTURE' : state.view === 'users' ? 'PEOPLE OF OPENDATER' : 'FROM HELLO TO SEE YOU'}</div><h1>${titles[state.view]}</h1><p>${descriptions[state.view]}</p></div>
      <div class="heading-actions">${state.view === 'overview' ? `<div class="segmented" role="group" aria-label="统计时间范围">${[7, 30, 90].map((days) => `<button data-action="period" data-days="${days}" aria-pressed="${state.days === days}">${days} 天</button>`).join('')}</div>` : ''}<button class="button" data-action="refresh" aria-label="刷新数据" ${state.loading ? 'disabled' : ''}>${icon('refresh')}<span class="refresh-label">刷新</span></button></div></div>`;
  }

  function renderShell() {
    if (!state.user) return renderLogin();
    root.innerHTML = `<div class="app-shell"><aside class="sidebar"><a class="brand" href="#overview" aria-label="见一面运营后台">${brand()}</a><p class="workspace-label">运营工作台</p>
      <nav class="nav" aria-label="后台导航">${Object.keys(titles).map((view) => `<a href="#${view}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(view === 'invitations' ? 'invites' : view)}${titles[view]}</a>`).join('')}</nav>
      <div class="sidebar-bottom"><a class="site-link" href="https://opendater.com" target="_blank" rel="noopener noreferrer">${icon('arrow')}打开见一面</a><p class="sidebar-note">用数据理解每一次相遇。<br>OPENDATER © ${new Date().getFullYear()}</p></div></aside>
      <div class="main-column"><header class="topbar"><div class="breadcrumb"><span class="breadcrumb-first">运营工作台</span><span aria-hidden="true">/</span><span>${titles[state.view]}</span></div><div class="account"><span class="avatar" aria-hidden="true">${esc((state.user.email || 'A').slice(0, 1).toUpperCase())}</span><span class="account-email">${esc(state.user.email)}</span><button class="text-button" data-action="logout">退出</button></div></header>
      <main class="content" id="main-content">${header()}${state.error ? `<div class="error-banner" role="alert"><span>${esc(state.error)}</span><button class="button" data-action="refresh">重新加载</button></div>` : ''}
      ${state.loading ? loadingView() : state.data ? state.view === 'overview' ? overview(state.data) : listView(state.data) : ''}
      <footer class="footer-note"><span>所有时间均为北京时间 · 数据仅限运营使用</span><span class="freshness">${state.loading ? '正在更新数据' : state.updatedAt ? `更新于 ${esc(dateTime(state.updatedAt))}` : '等待更新'}</span></footer></main></div></div><div id="drawer-root"></div>`;
    if (state.drawer) renderDrawer();
  }

  function loadingView() {
    const cards = Array.from({ length: 4 }, () => '<div class="skeleton-card"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-number"></div></div>').join('');
    return `<div aria-busy="true" aria-label="正在加载数据"><p class="sr-only" role="status">正在加载数据…</p>${state.view === 'overview' ? `<div class="stat-grid">${cards}</div><div class="dashboard-grid"><div class="skeleton-panel"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-chart"></div></div><div class="skeleton-panel"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-chart"></div></div></div>` : '<div class="skeleton-panel"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-chart"></div></div>'}</div>`;
  }

  function stat(label, value, detail, symbol) {
    return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon(symbol)}</span></div><p class="stat-value">${value}</p><p class="stat-bottom">${detail}</p></article>`;
  }
  function overview(data) {
    const totals = data.totals || {};
    const daily = data.daily || [];
    const funnel = data.funnel || {};
    const periodUsers = daily.reduce((sum, item) => sum + count(item.registrations), 0);
    const periodInvites = daily.reduce((sum, item) => sum + count(item.invitations), 0);
    return `<section class="stat-grid" aria-label="核心数据">
      ${stat('注册用户', number(totals.users), `<span class="stat-highlight">+${number(periodUsers)}</span>近 ${state.days} 天注册`, 'users')}
      ${stat('累计邀约', number(totals.invitations), `<span class="stat-highlight">+${number(periodInvites)}</span>近 ${state.days} 天创建`, 'invites')}
      ${stat('已敲定邀约', number(totals.confirmedInvitations), '当前双方已确认的邀约', 'check')}
      ${stat('邀约回应率', percent(funnel.responded, funnel.invitations), `近 ${state.days} 天创建的邀约`, 'overview')}
      </section>
      <section class="dashboard-grid" aria-label="趋势与转化"><article class="panel"><header class="panel-heading"><div><h2>新的开始</h2><p>每日注册与邀约创建趋势</p></div><div class="chart-legend"><span class="legend-item"><i class="legend-dot green"></i>注册</span><span class="legend-item"><i class="legend-dot"></i>邀约</span></div></header>${trendChart(daily)}</article>
      <article class="panel"><header class="panel-heading"><div><h2>从邀请到见面</h2><p>近 ${state.days} 天创建的邀约，后续走到了哪一步</p></div></header><div class="funnel">
      ${[['创建邀约', funnel.invitations], ['收到回应', funnel.responded], ['曾经敲定', funnel.everConfirmed]].map(([label, value]) => `<div class="funnel-row"><div class="funnel-row-label"><span>${label}</span><strong class="numeric">${number(value)}</strong></div><div class="funnel-track"><div class="funnel-fill" style="width:${count(funnel.invitations) ? Math.min(100, count(value) / count(funnel.invitations) * 100) : 0}%"></div></div></div>`).join('')}
      <div class="funnel-summary"><div><strong>${percent(funnel.responded, funnel.invitations)}</strong><p>创建 → 回应</p></div><div><strong>${percent(funnel.everConfirmed, funnel.invitations)}</strong><p>创建 → 敲定</p></div></div><p class="chart-caption">按邀约计数；“曾经敲定”包含后来改期或取消的邀约。</p></div></article></section>
      <section class="overview-bottom" aria-label="邀约与日程状态"><article class="panel"><header class="panel-heading"><div><h2>还有故事在继续</h2><p>全部邀约的当前状态</p></div><a class="text-button" href="#invitations">查看记录 ↗</a></header><div class="compact-grid">
      ${compact('等待回应', totals.waitingInvitations)}${compact('待发起人确认', totals.hostReviewInvitations)}${compact('待受邀人确认', totals.guestReviewInvitations)}${compact('商量细节中', totals.detailsInvitations)}
      </div></article><article class="panel"><header class="panel-heading"><div><h2>留给见面的时间</h2><p>日程使用与账户关联情况</p></div></header><div class="compact-grid">
      ${compact('已设置时间表的用户', totals.scheduledUsers)}${compact('待赴约安排', totals.upcomingBookings)}${compact('已绑定受邀用户', totals.boundGuests)}${compact('已取消邀约', totals.cancelledInvitations)}
      </div></article></section>
      <article class="panel"><header class="panel-heading"><h2>这些数字如何计算</h2></header><div class="definition-list"><p><strong>用户：</strong>仅统计已注册账户。匿名受邀人不计为新用户，也不会被当成独立访客计数。“已绑定受邀用户”按账户去重。</p><p><strong>回应率与转化：</strong>以所选时段内创建的邀约为一组，观察截至现在的回应与敲定情况；不是浏览量或独立人数。</p><p><strong>待赴约安排：</strong>已经占用日程且尚未结束的邀约，同一场约会关联两方账户时仍计为一场。</p></div></article>`;
  }
  const compact = (label, value) => `<div class="compact-stat"><p>${label}</p><strong>${number(value)}</strong></div>`;

  function trendChart(daily) {
    const max = Math.max(1, ...daily.flatMap((item) => [count(item.registrations), count(item.invitations)]));
    const total = daily.reduce((sum, item) => sum + count(item.registrations) + count(item.invitations), 0);
    const labels = daily.length ? [daily[0].date, daily[Math.floor((daily.length - 1) / 2)].date, daily[daily.length - 1].date] : [];
    const summary = `近 ${state.days} 天每日注册和创建邀约的数量。${total ? `单日最高 ${number(max)} 条。` : '这个时段还没有新注册或新邀约。'}`;
    return `<div class="trend-chart"><div class="chart-scale">数量 · 单日最高 ${number(max === 1 && !total ? 0 : max)}</div><div class="chart-body" style="gap:${daily.length > 60 ? 1 : daily.length > 14 ? 4 : 10}px" role="img" aria-label="${esc(summary)}">${daily.map((item) => `<div class="day-bars" title="${esc(item.date)} · 注册 ${number(item.registrations)} · 邀约 ${number(item.invitations)}"><span class="bar green" style="height:${count(item.registrations) / max * 100}%"></span><span class="bar" style="height:${count(item.invitations) / max * 100}%"></span></div>`).join('')}${!total ? '<span class="chart-empty">这段时间，等待新的故事</span>' : ''}</div><div class="chart-labels" aria-hidden="true">${labels.map((date) => `<span>${esc(String(date).slice(5).replace('-', '/'))}</span>`).join('')}</div><details class="table-disclosure"><summary>查看每日明细</summary><div class="table-wrap"><table class="data-table"><caption class="sr-only">每日新增注册和邀约</caption><thead><tr><th scope="col">日期</th><th scope="col">注册</th><th scope="col">邀约</th></tr></thead><tbody>${daily.map((item) => `<tr><th scope="row">${esc(item.date)}</th><td>${number(item.registrations)}</td><td>${number(item.invitations)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
  }

  function statusBadge(status) {
    const color = status === 'confirmed' ? 'green' : status === 'host_review' || status === 'guest_review' ? 'rose' : status === 'details' ? 'gold' : '';
    return `<span class="badge ${color}">${esc(statusLabels[status] || '状态待更新')}</span>`;
  }
  function option(value, label, selected) { return `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`; }

  function listView(data) {
    const users = state.view === 'users';
    const filters = state[state.view];
    const items = Array.isArray(data.items) ? data.items : [];
    const filtered = Object.entries(filters).some(([key, value]) => !['page', 'pageSize'].includes(key) && value);
    const toolbar = `<div class="table-toolbar"><form class="search-form" id="search-form"><div class="search-wrap">${icon('search')}<label for="search-input" class="sr-only">${users ? '搜索邮箱或用户名' : '搜索发起人邮箱或邀约双方称呼'}</label><input id="search-input" name="search" placeholder="${users ? '搜索邮箱或用户名' : '搜索邮箱或邀约双方称呼'}" value="${esc(filters.search)}" maxlength="100" type="search" /></div><button class="button" type="submit">搜索</button>${filtered ? '<button class="text-button" type="button" data-action="clear-filters">重置</button>' : ''}</form>
      <div class="filters">${users ? `<label class="sr-only" for="has-invitations-filter">是否发起过邀约</label><select id="has-invitations-filter" data-filter="hasInvitations">${option('', '全部用户', filters.hasInvitations)}${option('true', '发起过邀约', filters.hasInvitations)}${option('false', '还未发起邀约', filters.hasInvitations)}</select>` : `<label class="sr-only" for="status-filter">邀约状态</label><select id="status-filter" data-filter="status">${option('', '全部状态', filters.status)}${Object.entries(statusLabels).map(([value, label]) => option(value, label, filters.status)).join('')}</select><label class="sr-only" for="mode-filter">邀约模式</label><select id="mode-filter" data-filter="mode">${option('', '全部模式', filters.mode)}${Object.entries(modeLabels).map(([value, label]) => option(value, label, filters.mode)).join('')}</select>`}</div></div>`;
    return `<section class="panel" aria-label="${titles[state.view]}">${toolbar}${items.length ? users ? usersTable(items) : invitationsTable(items) : emptyState(filtered ? '没有找到匹配的记录' : users ? '还没有注册用户' : '还没有邀约记录', filtered ? '试试其他关键词，或重置筛选条件。' : users ? '有人完成注册后，会出现在这里。' : '用户创建第一份邀约后，就可以在这里查看进展。', users ? 'users' : 'invites')}${pagination(data)}</section>`;
  }
  function usersTable(items) {
    return `<div class="table-wrap"><table class="data-table"><caption class="sr-only">注册用户列表</caption><thead><tr><th scope="col">用户</th><th scope="col">注册时间</th><th scope="col">发起邀约</th><th scope="col">收到回应</th><th scope="col">已敲定</th><th scope="col">时间表</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead><tbody>${items.map((user) => `<tr><td><button class="user-link" data-action="user-detail" data-user-id="${esc(user.id)}"><span class="cell-primary">${esc(user.email)}</span><span class="cell-secondary">${esc(user.name || '未设置称呼')}</span></button></td><td class="numeric">${esc(dateTime(user.joinedAt))}</td><td class="numeric">${number(user.invitations)}</td><td class="numeric">${number(user.respondedInvitations)}</td><td class="numeric">${number(user.confirmedInvitations)}</td><td>${user.scheduleConfigured ? '<span class="badge green">已设置</span>' : '<span class="muted">未设置</span>'}</td><td><button class="text-button" data-action="user-detail" data-user-id="${esc(user.id)}" aria-label="查看 ${esc(user.email)} 的详情">详情 ↗</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function invitationsTable(items) {
    return `<div class="table-wrap"><table class="data-table"><caption class="sr-only">邀约记录列表</caption><thead><tr><th scope="col">邀约</th><th scope="col">发起人</th><th scope="col">当前状态</th><th scope="col">模式</th><th scope="col">选时方式</th><th scope="col">创建时间</th><th scope="col">最近更新</th></tr></thead><tbody>${items.map((item) => `<tr><td><span class="cell-primary">${esc(item.from || '未填写')} <span class="muted">→</span> ${esc(item.to || '未填写')}</span><span class="cell-secondary">#${esc(String(item.id).slice(-8))}${item.guestBound ? ' · 受邀人已绑定账户' : ''}</span></td><td><button class="user-link" data-action="user-detail" data-user-id="${esc(item.owner.id)}"><span class="cell-primary">${esc(item.owner.email)}</span></button></td><td>${statusBadge(item.status)}</td><td><span class="mode-pill">${esc(modeLabels[item.mode] || '其他模式')}</span></td><td><span class="mode-pill">${item.timePolicy === 'schedule' ? '使用时间表' : '自由选时'}</span></td><td class="numeric">${esc(dateTime(item.createdAt))}</td><td class="numeric">${esc(dateTime(item.updatedAt))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function pagination(data) {
    const page = Math.max(1, count(data.page));
    const totalPages = Math.max(1, Math.ceil(count(data.total) / Math.max(1, count(data.pageSize))));
    return `<div class="pagination"><span>共 ${number(data.total)} 条记录</span><div class="pagination-actions"><button class="button" data-action="page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button><span class="numeric">${page} / ${totalPages}</span><button class="button" data-action="page" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button></div></div>`;
  }
  function emptyState(title, description, symbol = 'overview') { return `<div class="empty-state"><span class="empty-icon">${icon(symbol)}</span><h3>${esc(title)}</h3><p>${esc(description)}</p></div>`; }

  function renderDrawer() {
    const mount = document.getElementById('drawer-root');
    if (!mount || !state.drawer) return;
    const drawer = state.drawer;
    const data = drawer.data;
    const user = data?.user;
    mount.innerHTML = `<div class="drawer-backdrop" data-action="close-backdrop"><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1"><header class="drawer-header"><h2 id="drawer-title">用户详情</h2><button class="icon-button" data-action="close-drawer" aria-label="关闭用户详情">${icon('close')}</button></header><div class="drawer-content">
      ${drawer.loading ? '<p role="status" class="muted">正在读取用户信息…</p>' : drawer.error ? `<div class="error-banner" role="alert">${esc(drawer.error)}</div><button class="button" data-action="retry-user" data-user-id="${esc(drawer.id)}">重新加载</button>` : user ? `<div class="profile-head"><span class="avatar" aria-hidden="true">${esc((user.email || 'U').slice(0, 1).toUpperCase())}</span><div><h3>${esc(user.name || '未设置称呼')}</h3><p>${esc(user.email)}</p></div></div>
      <dl class="profile-meta"><dt>注册时间</dt><dd>${esc(dateTime(user.joinedAt))}</dd><dt>邮箱状态</dt><dd>${user.emailVerified ? '已验证' : '未验证'}</dd><dt>时间表</dt><dd>${user.scheduleConfigured ? '已设置' : '尚未设置'}</dd><dt>用户编号</dt><dd class="numeric">${esc(user.id)}</dd></dl>
      <div class="drawer-metrics">${compact('发起邀约', user.invitations)}${compact('收到回应', user.respondedInvitations)}${compact('已敲定', user.confirmedInvitations)}</div><div class="drawer-metrics">${compact('绑定受邀记录', data.summary?.boundInvitations)}${compact('待赴约日程', data.summary?.upcomingBookings)}${compact('忙碌时段', data.summary?.manualBusyBlocks)}</div>
      <h3 class="drawer-section-title">相关邀约 <span class="muted">· ${number(data.invitationsTotal)}</span></h3>${data.invitations?.length ? data.invitations.map((item) => `<article class="mini-invite"><div class="mini-invite-top"><strong>${esc(item.from || '未填写')} → ${esc(item.to || '未填写')}</strong>${statusBadge(item.status)}</div><p>${item.role === 'guest' ? '作为受邀人' : '作为发起人'} · ${esc(modeLabels[item.mode] || '其他模式')}<br>${esc(dateTime(item.createdAt))} 创建 · #${esc(String(item.id).slice(-8))}</p></article>`).join('') : emptyState('还没有相关邀约', '发起邀约或主动绑定受邀记录后，会出现在这里。', 'invites')}
      <p class="detail-note">${count(data.invitationsTotal) > (data.invitations?.length || 0) ? `展示最近 ${number(data.invitations?.length)} 条记录。` : ''}仅展示邀约进展，不展示私人留言、具体地点和约会偏好。</p>` : ''}</div></section></div>`;
  }
  async function openUser(id) {
    if (!state.drawer) restoreFocus = document.activeElement;
    const sequence = ++drawerSequence;
    state.drawer = { id, loading: true, data: null, error: '' };
    renderDrawer();
    document.body.style.overflow = 'hidden';
    root.querySelector('.drawer')?.focus();
    try {
      const data = await request(`/api/admin/users/${encodeURIComponent(id)}`);
      if (sequence !== drawerSequence || !state.drawer) return;
      state.drawer = { id, loading: false, data, error: '' };
    } catch (error) {
      if (sequence !== drawerSequence || !state.drawer) return;
      if (error.status === 401 || error.status === 403) return loseSession(error);
      state.drawer = { id, loading: false, data: null, error: error.message };
    }
    renderDrawer();
    root.querySelector('[data-action="close-drawer"]')?.focus();
  }
  function closeDrawer() {
    drawerSequence += 1;
    state.drawer = null;
    document.body.style.overflow = '';
    const mount = document.getElementById('drawer-root');
    if (mount) mount.replaceChildren();
    if (restoreFocus?.isConnected) restoreFocus.focus();
    restoreFocus = null;
  }
  function loseSession(error) {
    closeDrawer();
    loadSequence += 1;
    state.user = null;
    state.data = null;
    state.login.otpSent = false;
    state.login.busy = false;
    state.login.error = error.status === 403 ? '这个账户暂时无法访问运营后台，请使用管理员邮箱登录。' : '登录已过期，请重新验证邮箱。';
    renderLogin();
  }
  async function loadPage() {
    if (!state.user) return;
    state.view = ['overview', 'users', 'invitations'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    const sequence = ++loadSequence;
    closeDrawer();
    state.loading = true;
    state.error = '';
    state.data = null;
    renderShell();
    try {
      const params = state.view === 'overview' ? { days: state.days } : state[state.view];
      const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '').map(([key, value]) => [key, String(value)]));
      const data = await request(`/api/admin/${state.view}?${query}`);
      if (sequence !== loadSequence) return;
      state.data = data;
      state.updatedAt = data.asOf || new Date().toISOString();
    } catch (error) {
      if (sequence !== loadSequence) return;
      if (error.status === 401 || error.status === 403) return loseSession(error);
      state.error = error.message;
    }
    state.loading = false;
    renderShell();
  }

  root.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.id === 'login-form' && !state.login.busy) {
      const fields = new FormData(form);
      if (state.login.otpSent) signIn(String(fields.get('otp') || '').trim());
      else sendCode(String(fields.get('email') || ''));
    } else if (form.id === 'search-form') {
      state[state.view].search = String(new FormData(form).get('search') || '').trim();
      state[state.view].page = 1;
      loadPage();
    }
  });
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'change-email') { state.login.otpSent = false; state.login.error = ''; renderLogin(); root.querySelector('#login-email')?.focus(); }
    else if (action === 'resend' && !state.login.busy && Date.now() >= state.login.retryAt) sendCode(state.login.email);
    else if (action === 'period') { state.days = Number(button.dataset.days); loadPage(); }
    else if (action === 'refresh') loadPage();
    else if (action === 'page') { state[state.view].page = Number(button.dataset.page); loadPage(); }
    else if (action === 'clear-filters') { for (const key of Object.keys(state[state.view])) { if (!['page', 'pageSize'].includes(key)) state[state.view][key] = ''; } state[state.view].page = 1; loadPage(); }
    else if (action === 'user-detail' || action === 'retry-user') openUser(button.dataset.userId);
    else if (action === 'close-drawer' || action === 'close-backdrop' && event.target === button) closeDrawer();
    else if (action === 'logout') {
      button.disabled = true;
      try {
        await post('/api/admin/auth/sign-out', {});
        closeDrawer();
        loadSequence += 1;
        state.user = null;
        state.data = null;
        state.updatedAt = null;
        state.users = { page: 1, pageSize: 20, search: '', hasInvitations: '' };
        state.invitations = { page: 1, pageSize: 20, search: '', status: '', mode: '' };
        state.login = { email: '', otpSent: false, busy: false, error: '', retryAt: 0 };
        renderLogin();
      } catch (error) { state.error = error.message; renderShell(); }
    }
  });
  root.addEventListener('change', (event) => {
    const filter = event.target.dataset.filter;
    if (!filter || !['users', 'invitations'].includes(state.view) || !(filter in state[state.view])) return;
    state[state.view][filter] = event.target.value;
    state[state.view].page = 1;
    loadPage();
  });
  document.addEventListener('keydown', (event) => {
    if (!state.drawer) return;
    if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
    if (event.key === 'Tab') {
      const dialog = root.querySelector('.drawer');
      const focusable = [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  window.addEventListener('hashchange', () => { if (state.user) loadPage(); });
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
  (async () => {
    try {
      const session = await request('/api/admin/session');
      state.user = session.user || null;
      if (state.user) await loadPage();
      else renderLogin();
    } catch (error) {
      state.login.error = error.status === 401 ? '' : error.status === 403 ? '请使用管理员邮箱登录运营后台。' : error.message;
      renderLogin();
    }
  })();
})();
