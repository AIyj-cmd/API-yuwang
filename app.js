// ===== 登录逻辑 =====
async function checkAuth() {
  try {
    const res = await fetch('/api/registry');
    if (res.status === 401) {
      showLoginPage();
      return false;
    }
    return true;
  } catch {
    showLoginPage();
    return false;
  }
}

function showLoginPage() {
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('main-content').style.display = 'none';
}

function hideLoginPage() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
}

async function doLogin() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  
  if (!username || !password) {
    errorEl.textContent = '请输入用户名和密码';
    errorEl.style.display = 'block';
    return;
  }
  
  try {
    const res = await fetch('/api/manager/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await res.json();
    
    if (data.success) {
      hideLoginPage();
      loadData();
      loadManagerConfig();
    } else {
      errorEl.textContent = data.message || '登录失败';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = '网络错误';
    errorEl.style.display = 'block';
  }
}

// 回车键登录
document.addEventListener('DOMContentLoaded', () => {
  const passwordInput = document.getElementById('login-password');
  if (passwordInput) {
    passwordInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') doLogin();
    });
  }
});
// ===== 状态 =====
let allRoutes = [];
let testRecords = {};  // { routeId: { lastTest: {...}, history: [...] } }
let currentTab = 'home';
let currentModuleFilter = '';
let selectedItems = new Set();
let changeMap = {};  // { 'METHOD:/path': 'new'|'removed'|'modified' }
const methodEmoji = { GET: '📥', POST: '📤', PATCH: '✏️', PUT: '📝', DELETE: '🗑️' };
const typeLabels = { public: '🌐 公开', authenticated: '🔑 登录用户', admin: '👑 管理员' };
const riskLabels = { low: '🟢 低', medium: '🟡 中', high: '🔴 高' };
const statusLabels = { implemented: '✅ 已实现', planned: '📋 规划中', deprecated: '🚫 废弃', refactor: '🔧 需重构' };
const frontendStatusLabels = {
  connected:    { label: '已接入',   icon: '✅', cls: 'fs-connected' },
  needs_review: { label: '待审核',   icon: '❓', cls: 'fs-needs-review' },
  admin_only:   { label: '仅后台',   icon: '👑', cls: 'fs-admin-only' },
  internal:     { label: '内部使用', icon: '⚙️', cls: 'fs-internal' },
  planned:      { label: '规划中',   icon: '📋', cls: 'fs-planned' },
  deprecated:   { label: '不接入',   icon: '🚫', cls: 'fs-deprecated' },
};

// 模块定义 - 从服务器加载，支持自定义扩展
let MODULE_MAP = {
  admin: { name: '管理后台', icon: '👑', desc: '后台管理功能：记录审核、用户管理、配置等' },
  records: { name: '摸鱼记录', icon: '🐟', desc: '记录的增删改查、互动、评论、分享' },
  groups: { name: '小组系统', icon: '👥', desc: '私密小组、邀请码、挑战、排名' },
  guilds: { name: '工会系统', icon: '⚔️', desc: '工会创建、加入、排名、任务' },
  circles: { name: '圈子系统', icon: '⭕', desc: '兴趣圈子、加入、动态、排名' },
  auth: { name: '用户认证', icon: '🔐', desc: '注册、登录、用户信息管理' },
  notifications: { name: '消息通知', icon: '🔔', desc: '通知列表、已读状态' },
  system: { name: '系统功能', icon: '⚙️', desc: '健康检查、配置、公告' },
  wallet: { name: '鱼鳞钱包', icon: '💰', desc: '虚拟货币余额、交易记录' },
  users: { name: '用户系统', icon: '👤', desc: '用户资料、个人主页、成就' },
  checkins: { name: '签到系统', icon: '✅', desc: '每日签到' },
  topics: { name: '话题系统', icon: '#️⃣', desc: '热门话题、话题详情' },
  community: { name: '社区广场', icon: '📢', desc: '公共内容流、热门内容' },
  stats: { name: '统计数据', icon: '📊', desc: '站点统计' },
  feedback: { name: '反馈建议', icon: '💡', desc: '用户反馈' },
  leaderboards: { name: '排行榜', icon: '🏆', desc: '各类排行榜数据' },
  search: { name: '搜索功能', icon: '🔍', desc: '全站搜索' },
  badges: { name: '徽章成就', icon: '🏅', desc: '徽章、成就系统' },
  other: { name: '其他', icon: '📦', desc: '未分类接口' }
};
const MODULE_ORDER = ['admin', 'records', 'groups', 'guilds', 'circles', 'auth', 'notifications', 'system', 'wallet', 'users', 'checkins', 'topics', 'community', 'stats', 'feedback', 'leaderboards', 'search', 'badges'];

// ===== 变更检测 =====
function routeKey(route) {
  return `${route.method}:${route.path}`;
}

function routeSignature(route) {
  // 关键字段的指纹，用于检测"修改"
  return [route.method, route.path, route.apiType, route.authType, route.riskLevel, route.status, route.module, route.name].join('|');
}

function saveSnapshot() {
  const snapshot = {};
  allRoutes.forEach(r => { snapshot[routeKey(r)] = routeSignature(r); });
  localStorage.setItem('api-snapshot', JSON.stringify(snapshot));
  // 保存完整路由数据用于影响分析
  const fullSnapshot = {};
  allRoutes.forEach(r => { fullSnapshot[routeKey(r)] = { method: r.method, path: r.path, apiType: r.apiType, authType: r.authType, riskLevel: r.riskLevel, status: r.status, module: r.module, name: r.name, frontendUsage: r.frontendUsage || [] }; });
  localStorage.setItem('api-snapshot-full', JSON.stringify(fullSnapshot));
}

function detectChanges() {
  const prev = JSON.parse(localStorage.getItem('api-snapshot') || '{}');
  const current = {};
  changeMap = {};

  allRoutes.forEach(r => {
    const key = routeKey(r);
    current[key] = routeSignature(r);
    if (!prev[key]) {
      changeMap[key] = 'new';
    } else if (prev[key] !== current[key]) {
      changeMap[key] = 'modified';
    }
  });

  Object.keys(prev).forEach(key => {
    if (!current[key]) {
      changeMap[key] = 'removed';
    }
  });

  saveSnapshot();
}

function getChangeCount(type) {
  return Object.values(changeMap).filter(v => v === type).length;
}

// ===== 标签页切换 =====
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.nav-tab[onclick="switchTab('${tab}')"]`).classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${tab}`).classList.add('active');
  if (tab === 'features') {
    currentModuleFilter = '';
    renderCategories();
  }
  if (tab === 'claude') {
    renderClaudeRouteList();
    loadClaudeDrafts();
  }
  if (tab === 'perm') {
    renderPermissionMatrix();
  }
  if (tab === 'packs') {
    loadFeaturePacks();
  }
  if (tab === 'impact') {
    renderImpactAnalysis();
  }
  if (tab === 'dedup') {
    runDedupAnalysis();
  }
  if (tab === 'lifecycle') {
    renderLifecycle();
  }
  if (tab === 'prerelease') {
    // 自动生成检查
    if (!document.querySelector('#prereleaseContent .prerelease-report')) {
      generatePrereleaseCheck();
    }
  }
}

// ===== 数据加载 =====
async function loadData() {
  try {
    const [routesRes, modulesRes] = await Promise.all([
      fetch('/api/registry'),
      fetch('/api/modules')
    ]);
    allRoutes = await routesRes.json();

    // 合并服务器模块配置
    const serverModules = await modulesRes.json();
    Object.entries(serverModules).forEach(([key, val]) => {
      MODULE_MAP[key] = {
        name: val.name,
        icon: val.icon,
        desc: val.description || val.desc || ''
      };
    });

    // 加载测试记录
    try {
      const trRes = await fetch('/api/test-records', { credentials: 'include' });
      const trData = await trRes.json();
      if (trData.success) testRecords = trData.records || {};
    } catch {}

    detectChanges();
    updateStats();
    renderDashboard();
    renderList();
    if (currentTab === 'features') renderCategories();
  } catch (err) {
    console.error('加载失败:', err);
  }
}

function updateStats() {
  document.getElementById('totalCount').textContent = `总计: ${allRoutes.length}`;
  document.getElementById('highRiskCount').textContent = `高风险: ${allRoutes.filter(r => r.riskLevel === 'high').length}`;
  document.getElementById('noFrontendCount').textContent = `未接入前端: ${allRoutes.filter(r => r.frontendUsage.length === 0).length}`;
  document.getElementById('totalCount2').textContent = `总计: ${allRoutes.length}`;
  document.getElementById('publicCount').textContent = `公开: ${allRoutes.filter(r => r.apiType !== 'admin').length}`;
  document.getElementById('adminCount').textContent = `管理: ${allRoutes.filter(r => r.apiType === 'admin').length}`;
}

// ===== 渲染：健康度仪表盘 =====
function renderDashboard() {
  const stats = {
    total: allRoutes.length,
    highRisk: allRoutes.filter(r => r.riskLevel === 'high').length,
    noFrontend: allRoutes.filter(r => r.frontendUsage.length === 0).length,
    hasAudit: allRoutes.filter(r => r.hasAuditLog).length,
    tested: allRoutes.filter(r => { const rid = r.route_id || `${r.method}:${r.path}`; return testRecords[rid] && testRecords[rid].lastTest; }).length,
    testPassed: allRoutes.filter(r => { const rid = r.route_id || `${r.method}:${r.path}`; return testRecords[rid]?.lastTest?.conclusion === 'passed'; }).length,
    testFailed: allRoutes.filter(r => { const rid = r.route_id || `${r.method}:${r.path}`; return testRecords[rid]?.lastTest?.conclusion === 'failed'; }).length
  };
  // 未接入原因分组（仅统计实际未被前端调用的接口）
  const reasonCounts = {};
  allRoutes.filter(r => r.frontendUsage.length === 0).forEach(r => {
    const s = r.frontendStatus || 'needs_review';
    reasonCounts[s] = (reasonCounts[s] || 0) + 1;
  });
  const reasonOrder = ['needs_review', 'admin_only', 'internal', 'planned', 'deprecated'];
  const reasonHtml = reasonOrder
    .filter(k => reasonCounts[k])
    .map(k => {
      const fs = frontendStatusLabels[k] || frontendStatusLabels.needs_review;
      return `<span class="reason-chip ${fs.cls}" onclick="quickFilter('fs:${k}')">${fs.icon} ${fs.label} ${reasonCounts[k]}</span>`;
    }).join('');

  document.getElementById('healthDashboard').innerHTML = `
    <div class="health-card info" onclick="quickFilter('')">
      <div class="icon">📊</div>
      <div class="value">${stats.total}</div>
      <div class="label">总接口数</div>
    </div>
    <div class="health-card danger" onclick="quickFilter('high-risk')">
      <div class="icon">🔴</div>
      <div class="value">${stats.highRisk}</div>
      <div class="label">高风险接口</div>
      <div class="card-hint">点击筛选</div>
    </div>
    <div class="health-card warning">
      <div class="icon">⚠️</div>
      <div class="value">${stats.noFrontend}</div>
      <div class="label">未接入前端</div>
      <div class="reason-chips">${reasonHtml}</div>
    </div>
    <div class="health-card success">
      <div class="icon">📝</div>
      <div class="value">${stats.hasAudit}</div>
      <div class="label">写审计日志</div>
    </div>
    <div class="health-card ${stats.testFailed > 0 ? 'danger' : 'info'}" onclick="quickFilter('untested')">
      <div class="icon">🧪</div>
      <div class="value">${stats.tested}/${stats.total}</div>
      <div class="label">已测试</div>
      <div class="card-hint">✅${stats.testPassed} ❌${stats.testFailed} ❓${stats.total - stats.tested}</div>
    </div>
  `;
}

// ===== 渲染：API 列表 =====
function renderList() {
  const filtered = filterRoutes();

  if (filtered.length === 0) {
    document.getElementById('apiList').innerHTML = '<div class="empty-state">没有找到匹配的接口</div>';
    return;
  }

  document.getElementById('apiList').innerHTML = filtered.map(route => {
    const idx = allRoutes.indexOf(route);
    return renderApiRow(route, idx);
  }).join('');
}

function filterRoutes() {
  const methodFilter = document.getElementById('filterMethod').value;
  const typeFilter = document.getElementById('filterType').value;
  const riskFilter = document.getElementById('filterRisk').value;
  const specialFilter = document.getElementById('filterSpecial').value;
  const search = document.getElementById('searchQuery').value.toLowerCase();

  return allRoutes.filter(route => {
    if (methodFilter && route.method !== methodFilter) return false;
    if (typeFilter && route.apiType !== typeFilter) return false;
    if (riskFilter && route.riskLevel !== riskFilter) return false;
    if (specialFilter === 'no-frontend' && route.frontendUsage.length > 0) return false;
    if (specialFilter === 'high-risk' && route.riskLevel !== 'high') return false;
    if (specialFilter === 'no-auth' && route.authType !== 'anonymous') return false;
    if (specialFilter === 'has-audit' && !route.hasAuditLog) return false;
    if (specialFilter === 'changed' && !changeMap[routeKey(route)]) return false;
    if (specialFilter && specialFilter.startsWith('tested-')) {
      const targetConclusion = specialFilter.slice(7);
      const rid = route.route_id || `${route.method}:${route.path}`;
      const rec = testRecords[rid];
      if (!rec || !rec.lastTest || rec.lastTest.conclusion !== targetConclusion) return false;
    }
    if (specialFilter === 'untested') {
      const rid = route.route_id || `${route.method}:${route.path}`;
      if (testRecords[rid] && testRecords[rid].lastTest) return false;
    }
    if (specialFilter && specialFilter.startsWith('fs:') && route.frontendStatus !== specialFilter.slice(3)) return false;
    if (currentModuleFilter && route.module !== currentModuleFilter) return false;
    if (search && !route.name.toLowerCase().includes(search) && !route.path.toLowerCase().includes(search)) return false;
    return true;
  });
}

function renderApiRow(route, idx) {
  const key = routeKey(route);
  const change = changeMap[key];
  const changeBadge = change === 'new' ? '<span class="change-badge new">🆕 新增</span>'
    : change === 'modified' ? '<span class="change-badge modified">✏️ 变更</span>'
    : '';

  const fs = frontendStatusLabels[route.frontendStatus] || frontendStatusLabels.needs_review;
  const frontendHtml = `<span class="frontend-status ${fs.cls}">${fs.icon} ${fs.label}</span>`;
  const dbHtml = route.dbTables.length > 0
    ? `<span class="db-tables">${route.dbTables.join(', ')}</span>`
    : `<span style="color:#9ca3af;font-size:11px">-</span>`;

  return `
    <div class="api-item ${change ? 'changed-' + change : ''}" id="api-item-${idx}">
      <span class="checkbox-col"><input type="checkbox" data-idx="${idx}" onchange="toggleItem(${idx})" /></span>
      <span class="method-badge ${route.method.toLowerCase()}">${methodEmoji[route.method] || route.method} ${route.method}</span>
      <div>
        <div class="api-name">${route.name} ${changeBadge} ${renderTestBadge(route)}</div>
        <div class="api-path">${route.file}:${route.line}</div>
      </div>
      <span><code>${route.path}</code></span>
      <span class="type-badge ${route.apiType}">${typeLabels[route.apiType]}</span>
      <span class="risk-badge ${route.riskLevel}">${riskLabels[route.riskLevel]}</span>
      <span>${frontendHtml}</span>
      <span>${dbHtml}</span>
      <span class="actions">
        <button class="btn-icon" onclick="viewDetail(${idx})" title="查看详情">👁️</button>
        <button class="btn-icon favorite-btn ${route.favorite ? 'active' : ''}" onclick="toggleFavorite(${idx})" title="收藏">
          ${route.favorite ? '⭐' : '☆'}
        </button>
      </span>
    </div>
  `;
}

// ===== 渲染：分类卡片 =====
function renderCategories() {
  const modules = {};
  allRoutes.forEach(route => {
    const module = route.module || '未分类';
    if (!modules[module]) modules[module] = { count: 0 };
    modules[module].count++;
  });

  const html = MODULE_ORDER.filter(key => modules[key]).map(key => {
    const data = modules[key];
    const mod = MODULE_MAP[key] || MODULE_MAP['other'];
    return renderCategoryCard(key, data, mod);
  }).join('');

  document.getElementById('categoryGrid').innerHTML = html;
  renderCoverage();
}

function renderCategoryCard(key, data, mod) {
  return `
    <div class="category-card" onclick="filterByModule('${key}')">
      <div class="card-icon">${mod.icon}</div>
      <div class="card-count">${data.count}</div>
      <div class="card-title">${mod.name}</div>
      <div class="card-desc">${mod.desc}</div>
    </div>
  `;
}

// ===== 渲染：覆盖率统计 =====
const INTERNAL_PATHS = ['/api/health', '/api/scan', '/api/sync', '/api/proxy', '/api/sync-changes'];
function isInternalPath(path) {
  return INTERNAL_PATHS.some(p => path === p || path.startsWith(p + '/'));
}
function shouldConnectFrontend(route) {
  if (typeof getLifecycle === 'function') {
    if (getLifecycle(route) === 'removed') return false;
    if (getLifecycle(route) === 'deprecated') return false;
  }
  if (route.frontendStatus === 'admin_only' || route.frontendStatus === 'internal' ||
      route.frontendStatus === 'deprecated' || route.frontendStatus === 'needs_review') return false;
  if (route.path.startsWith('/api/admin/')) return false;
  if (isInternalPath(route.path)) return false;
  return true;
}
function isBackendApi(route) {
  return route.path.startsWith('/api/admin/') || route.frontendStatus === 'admin_only';
}
function pctColor(pct) { return pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'; }
function pctBar(pct) {
  return `<div style="height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${pctColor(pct)};border-radius:4px;transition:width 0.3s"></div></div>`;
}
function rateCard(label, numerator, denominator, icon) {
  if (denominator === 0) {
    return `<div style="flex:1;min-width:180px;padding:16px;background:#f9fafb;border-radius:10px;text-align:center">
      <div style="font-size:24px;margin-bottom:4px">${icon}</div>
      <div style="font-size:16px;font-weight:600;color:#9ca3af;margin-top:8px">暂无待接接口</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px">待分类后计算</div>
    </div>`;
  }
  const pct = Math.round((numerator / denominator) * 100);
  return `<div style="flex:1;min-width:180px;padding:16px;background:#f9fafb;border-radius:10px;text-align:center">
    <div style="font-size:24px;margin-bottom:4px">${icon}</div>
    <div style="font-size:28px;font-weight:700;color:${pctColor(pct)}">${pct}%</div>
    <div style="font-size:12px;color:#6b7280;margin-bottom:6px">${label}</div>
    <div style="font-size:11px;color:#9ca3af">${numerator} / ${denominator}</div>
    ${pctBar(pct)}
  </div>`;
}

function renderCoverage() {
  const section = document.getElementById('coverageSection');
  if (!section) return;

  // 全部接口调用率
  const allUsed = allRoutes.filter(r => r.frontendUsage.length > 0);

  // 前台接入率：只算"应该接入前台"的接口
  const feRoutes = allRoutes.filter(r => shouldConnectFrontend(r));
  const feUsed = feRoutes.filter(r => r.frontendUsage.length > 0);

  // 后台接入率：只算 /api/admin/ 或 admin_only 的接口
  const beRoutes = allRoutes.filter(r => isBackendApi(r));
  const beUsed = beRoutes.filter(r => r.frontendUsage.length > 0);

  // 待审核：未接入且标记为 needs_review
  const pendingReview = allRoutes.filter(r => r.frontendUsage.length === 0 && r.frontendStatus === 'needs_review');

  // 未接入前台（仅"应该接入前台"但没有被调用的）
  const feMissing = feRoutes.filter(r => r.frontendUsage.length === 0);

  // 按 frontendStatus 分组展示全部未接入（排除已接入的）
  const groupOrder = ['needs_review', 'admin_only', 'internal', 'planned', 'deprecated', 'connected'];
  const groupLabels = {
    needs_review: { label: '待审核', icon: '❓', color: '#f59e0b' },
    admin_only:   { label: '仅后台', icon: '👑', color: '#3b82f6' },
    internal:     { label: '内部接口', icon: '⚙️', color: '#6b7280' },
    planned:      { label: '未来计划', icon: '📋', color: '#8b5cf6' },
    deprecated:   { label: '准备废弃', icon: '🚫', color: '#ef4444' },
    connected:    { label: '已接入', icon: '✅', color: '#10b981' },
  };

  // 分组：未接入的接口（frontendUsage.length === 0），按 frontendStatus 分
  const unused = allRoutes.filter(r => r.frontendUsage.length === 0);
  const byStatus = {};
  unused.forEach(r => {
    const s = r.frontendStatus || 'needs_review';
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push(r);
  });

  const groupHtml = groupOrder
    .filter(k => byStatus[k] && byStatus[k].length > 0)
    .map(k => {
      const routes = byStatus[k];
      const g = groupLabels[k] || groupLabels.needs_review;
      return `<div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f9fafb;border-radius:8px;cursor:pointer" onclick="quickFilter('fs:${k}')">
          <span style="font-size:20px">${g.icon}</span>
          <span style="flex:1;font-size:14px;font-weight:600">${g.label}</span>
          <span style="font-size:13px;color:${g.color};font-weight:600">${routes.length} 个</span>
        </div>
        <div style="padding:4px 12px">
          ${routes.slice(0, 5).map(r => `<div style="font-size:12px;color:#6b7280;padding:3px 0;font-family:monospace">${r.method} ${r.path}</div>`).join('')}
          ${routes.length > 5 ? `<div style="font-size:11px;color:#9ca3af;padding:3px 0;cursor:pointer" onclick="quickFilter('fs:${k}')">...还有 ${routes.length - 5} 个，点击查看</div>` : ''}
        </div>
      </div>`;
    }).join('');

  section.innerHTML = `
    <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb">
      <h3 style="font-size:16px;font-weight:600;margin-bottom:16px">📊 接入率统计</h3>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
        ${rateCard('全部接口调用率', allUsed.length, allRoutes.length, '📊')}
        ${rateCard('前台接入率', feUsed.length, feRoutes.length, '🖥️')}
        ${rateCard('后台接入率', beUsed.length, beRoutes.length, '🔧')}
        <div style="flex:1;min-width:180px;padding:16px;background:#fef3c7;border-radius:10px;text-align:center">
          <div style="font-size:24px;margin-bottom:4px">❓</div>
          <div style="font-size:28px;font-weight:700;color:#92400e">${pendingReview.length}</div>
          <div style="font-size:12px;color:#6b7280">待审核接口</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:4px">不计入任何接入率</div>
        </div>
      </div>
      ${feMissing.length > 0 ? `
      <div style="padding:12px 16px;background:#fef2f2;border-radius:8px;margin-bottom:16px;border:1px solid #fecaca">
        <span style="font-size:13px;font-weight:600;color:#991b1b">⚠️ 真正需要前台接入但未接入：${feMissing.length} 个</span>
        <span style="font-size:12px;color:#b91c1c;margin-left:8px">（前台接入率的缺口）</span>
      </div>` : ''}
      ${unused.length > 0 ? `
      <div style="margin-top:16px">
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px">📋 未接入接口按状态分组 (${unused.length})</div>
        <div style="max-height:400px;overflow-y:auto">${groupHtml}</div>
      </div>
      ` : '<div style="text-align:center;padding:20px;color:#10b981">✅ 所有接口已接入</div>'}
    </div>
  `;
}

// ===== 添加新模块 =====
async function addModule() {
  const key = document.getElementById('newModuleKey').value.trim();
  const name = document.getElementById('newModuleName').value.trim();
  const icon = document.getElementById('newModuleIcon').value.trim();
  const desc = document.getElementById('newModuleDesc').value.trim();

  if (!key || !name || !icon) {
    showToast('请填写 Key、名称和图标');
    return;
  }

  try {
    await fetch('/api/modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: { name, icon, description: desc } })
    });

    // 更新本地
    MODULE_MAP[key] = { name, icon, desc };
    if (!MODULE_ORDER.includes(key)) MODULE_ORDER.push(key);

    // 清空表单
    ['newModuleKey', 'newModuleName', 'newModuleIcon', 'newModuleDesc'].forEach(id => document.getElementById(id).value = '');

    renderCategories();
    showToast(`模块 "${name}" 已添加`);
  } catch (err) {
    showToast('添加失败');
  }
}

// ===== 按模块筛选 =====
function filterByModule(module) {
  currentModuleFilter = module;
  switchTab('home');
  renderList();
}

// ===== 快捷筛选 =====
function quickFilter(value) {
  document.getElementById('filterSpecial').value = value;
  switchTab('home');
  renderList();
}

// ===== 渲染：详情弹窗 =====
function viewDetail(index) {
  const route = allRoutes[index];
  const body = document.getElementById('detailBody');

  body.innerHTML = `
    <div class="detail-grid">
      ${renderDetailField('📝 接口名称', route.name)}
      ${renderDetailField('🔗 请求方法', `<span class="method-badge ${route.method.toLowerCase()}">${methodEmoji[route.method] || route.method} ${route.method}</span>`)}
      ${renderDetailField('🛣️ 接口路径', `<code>${route.path}</code>`)}
      ${renderDetailField('🏷️ 接口类型', `<span class="type-badge ${route.apiType}">${typeLabels[route.apiType]}</span>`)}
      ${renderDetailField('🔐 权限要求', `<span class="type-badge ${route.authType === 'admin' ? 'admin' : route.authType === 'user' ? 'authenticated' : 'public'}">${route.authType === 'admin' ? '👑 管理员' : route.authType === 'user' ? '🔑 登录用户' : '🌐 匿名'}</span>`)}
      ${renderDetailField('风险等级', `<span class="risk-badge ${route.riskLevel}">${riskLabels[route.riskLevel]}</span>`)}
      ${renderDetailField('状态', statusLabels[route.status] || route.status)}
      <div class="detail-row">
        <label>前端接入状态</label>
        <select id="detailFrontendStatus" onchange="updateFrontendStatus(${index}, this.value)" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
          ${Object.entries(frontendStatusLabels).map(([k, v]) => `<option value="${k}" ${route.frontendStatus === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('')}
        </select>
      </div>
      ${renderDetailField('📁 源文件', `${route.file}:${route.line}`)}
    </div>
    ${renderDetailField('前端使用位置', route.frontendUsage.length > 0 ? '✅ ' + route.frontendUsage.join(', ') : '⚠️ 未接入前端')}
    ${renderDetailField('关联数据库表', route.dbTables.length > 0 ? '🗄️ ' + route.dbTables.join(', ') : '📭 无直接数据库操作')}
    ${renderDetailField('审计日志', route.hasAuditLog ? '✅ 写审计日志' : '❌ 不写审计日志')}
    <div class="detail-row">
      <label>自定义描述</label>
      <textarea id="detailDesc" placeholder="添加接口描述..." onblur="updateDesc(${index}, this.value)">${route.customDescription || ''}</textarea>
    </div>
    <div class="detail-row">
      <label>标签</label>
      <div class="tags-input">
        ${(route.tags || []).map((tag, i) => `<span class="tag">${tag}<button onclick="removeTag(${index}, ${i})">✕</button></span>`).join('')}
        <input id="newTagInput" placeholder="添加标签..." onkeyup="if(event.key==='Enter')addTag(${index})" />
      </div>
    </div>
    ${renderTestRecordSection(route)}
    <div style="margin-top:20px;display:flex;gap:12px">
      <button class="btn btn-primary" onclick="closeModal()">关闭</button>
      <button class="btn btn-secondary" onclick="toggleTestPanel(${index})">🧪 测试接口</button>
      <button class="btn btn-secondary" onclick="toggleManualRecord(${index})">📝 手动记录</button>
    </div>
    <div id="testPanel" style="display:none;margin-top:16px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <span class="method-badge ${route.method.toLowerCase()}">${route.method}</span>
        <code style="flex:1">${route.path}</code>
      </div>
      ${(() => {
        const risk = route.riskOverride || route.detectedRisk || route.riskLevel;
        const auth = route.accessOverride || route.detectedAuth || route.authType;
        const isHighRisk = route.method === 'DELETE' || risk === 'high' || auth === 'admin';
        const isWrite = ['POST','PATCH','PUT'].includes(route.method);
        const isGet = route.method === 'GET';
        let hint = '', btnLabel = '', btnClass = '';
        if (isGet) {
          hint = '🟢 真实请求 — 会实际调用后端接口';
          btnLabel = '🚀 发送请求';
          btnClass = 'btn-primary';
        } else if (isHighRisk) {
          hint = '🔒 仅模拟 — 高风险/管理员接口禁止真实执行';
          btnLabel = '🔒 模拟请求';
          btnClass = 'btn-secondary';
        } else if (isWrite) {
          hint = '🧪 模拟请求 — 不会真实写入数据';
          btnLabel = '🧪 模拟请求';
          btnClass = 'btn-secondary';
        } else {
          hint = '🧪 模拟请求';
          btnLabel = '🧪 模拟请求';
          btnClass = 'btn-secondary';
        }
        return `
      <div style="margin-bottom:8px;padding:8px 12px;background:${isGet?'#ecfdf5':'#fef3c7'};border-radius:6px;font-size:12px;color:${isGet?'#065f46':'#92400e'}">
        ${hint}
      </div>
      ${!isGet ? `
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:4px">请求体 (JSON)</label>
        <textarea id="testBody" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-family:monospace;font-size:13px;min-height:80px" placeholder='{"key": "value"}'></textarea>
      </div>
      ` : ''}
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn ${btnClass}" onclick="sendTestRequest(${index})">${btnLabel}</button>
        <span id="testStatus" style="font-size:13px;color:#6b7280"></span>
      </div>`;
      })()}
      <div id="testResult" style="margin-top:12px;display:none">
        <label style="font-size:12px;color:#6b7280;display:block;margin-bottom:4px">响应结果</label>
        <pre id="testResponse" style="padding:12px;background:#1f2937;color:#10b981;border-radius:6px;font-size:12px;overflow-x:auto;max-height:300px;overflow-y:auto"></pre>
      </div>
    </div>
    <div id="manualRecordPanel" style="display:none;margin-top:16px;padding:16px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0">
      <h4 style="font-size:14px;font-weight:600;margin-bottom:12px">📝 手动记录测试结果</h4>
      <div class="detail-grid">
        <div class="detail-row">
          <label>验收结论</label>
          <select id="manualConclusion" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px">
            <option value="passed">✅ 通过</option>
            <option value="failed">❌ 失败</option>
            <option value="pending">⏳ 待复查</option>
          </select>
        </div>
        <div class="detail-row">
          <label>响应码</label>
          <input id="manualStatusCode" placeholder="如 200、404" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px" />
        </div>
      </div>
      <div class="detail-row" style="margin-top:8px">
        <label>备注</label>
        <textarea id="manualNotes" placeholder="测试情况、失败原因等..." style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;min-height:60px;resize:vertical"></textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-primary" onclick="saveManualRecord(${index})">💾 保存记录</button>
        <button class="btn btn-secondary" onclick="document.getElementById('manualRecordPanel').style.display='none'">取消</button>
      </div>
    </div>
  `;

  document.getElementById('detailModal').style.display = 'flex';
}

function renderDetailField(label, value) {
  return `<div class="detail-row"><label>${label}</label><div class="value">${value}</div></div>`;
}

function renderTestBadge(route) {
  const routeId = route.route_id || `${route.method}:${route.path}`;
  const record = testRecords[routeId];
  if (!record || !record.lastTest) return '';
  const t = record.lastTest;
  const map = {
    passed: { icon: '✅', cls: 'test-passed', text: '通过' },
    failed: { icon: '❌', cls: 'test-failed', text: '失败' },
    pending: { icon: '⏳', cls: 'test-pending', text: '待复查' }
  };
  const info = map[t.conclusion] || map.pending;
  return `<span class="test-badge ${info.cls}" title="${info.text} · ${new Date(t.timestamp).toLocaleDateString('zh-CN')}">${info.icon}</span>`;
}

function renderTestRecordSection(route) {
  const routeId = route.route_id || `${route.method}:${route.path}`;
  const record = testRecords[routeId];
  if (!record || !record.lastTest) {
    return `<div style="padding:12px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;margin-top:12px">
      <div style="font-size:13px;color:#9ca3af;text-align:center">📋 暂无测试记录</div>
    </div>`;
  }
  const t = record.lastTest;
  const conclusionMap = { passed: '✅ 通过', failed: '❌ 失败', pending: '⏳ 待复查' };
  const conclusionColor = { passed: '#10b981', failed: '#ef4444', pending: '#f59e0b' };
  const methodMap = { real: '🚀 真实请求', dryRun: '🧪 模拟请求', manual: '📝 手动记录' };
  const methodLabel = methodMap[t.method] || '🧪 模拟请求';
  const timeStr = new Date(t.timestamp).toLocaleString('zh-CN');
  const historyCount = (record.history || []).length;

  return `
    <div style="padding:14px;background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:13px;font-weight:600;color:#374151">📋 最近测试记录</span>
        <span style="font-size:11px;color:#9ca3af">共 ${historyCount} 条记录</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;font-size:12px">
        <div>
          <div style="color:#9ca3af;margin-bottom:2px">结论</div>
          <div style="font-weight:600;color:${conclusionColor[t.conclusion] || '#6b7280'}">${conclusionMap[t.conclusion] || t.conclusion}</div>
        </div>
        <div>
          <div style="color:#9ca3af;margin-bottom:2px">测试方式</div>
          <div>${methodLabel}</div>
        </div>
        <div>
          <div style="color:#9ca3af;margin-bottom:2px">时间</div>
          <div>${timeStr}</div>
        </div>
        ${t.statusCode ? `<div><div style="color:#9ca3af;margin-bottom:2px">响应码</div><div style="font-family:monospace;font-weight:600">${t.statusCode}</div></div>` : ''}
        ${t.responseTime ? `<div><div style="color:#9ca3af;margin-bottom:2px">耗时</div><div>${t.responseTime}ms</div></div>` : ''}
        ${t.notes ? `<div style="grid-column:span 3"><div style="color:#9ca3af;margin-bottom:2px">备注</div><div style="color:#374151">${t.notes}</div></div>` : ''}
      </div>
    </div>
  `;
}

function toggleManualRecord(index) {
  const panel = document.getElementById('manualRecordPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function saveManualRecord(index) {
  const route = allRoutes[index];
  const routeId = route.route_id || `${route.method}:${route.path}`;
  const conclusion = document.getElementById('manualConclusion').value;
  const statusCode = document.getElementById('manualStatusCode').value;
  const notes = document.getElementById('manualNotes').value.trim();

  try {
    const res = await fetch('/api/test-records', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routeId,
        testMethod: 'manual',
        statusCode: statusCode ? parseInt(statusCode) : null,
        conclusion,
        notes
      })
    });
    const data = await res.json();
    if (data.success) {
      testRecords[routeId] = data.record;
      showToast('✅ 测试记录已保存');
      document.getElementById('manualRecordPanel').style.display = 'none';
      // 重新渲染详情
      viewDetail(index);
    }
  } catch (e) {
    showToast('❌ 保存失败');
  }
}

function closeModal() {
  document.getElementById('detailModal').style.display = 'none';
}

function toggleTestPanel(index) {
  const panel = document.getElementById('testPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function sendTestRequest(index) {
  const route = allRoutes[index];
  const statusEl = document.getElementById('testStatus');
  const resultEl = document.getElementById('testResult');
  const responseEl = document.getElementById('testResponse');

  statusEl.textContent = '发送中...';
  statusEl.style.color = '#6b7280';
  resultEl.style.display = 'none';

  const startTime = Date.now();
  try {
    const options = { method: route.method, headers: { 'Content-Type': 'application/json' } };

    if (route.method !== 'GET') {
      const bodyEl = document.getElementById('testBody');
      if (bodyEl && bodyEl.value.trim()) {
        options.body = bodyEl.value;
      }
    }

    const isDryRun = route.method !== 'GET';
    const proxyRes = await fetch('/api/proxy', {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMethod: route.method,
        targetPath: route.path,
        requestBody: options.body ? JSON.parse(options.body) : undefined,
        dryRun: isDryRun
      })
    });
    const elapsed = Date.now() - startTime;
    const data = await proxyRes.json();

    const prefix = isDryRun ? '🧪 模拟' : '🟢 真实';
    statusEl.textContent = `${prefix} · ${proxyRes.status} · ${elapsed}ms`;
    statusEl.style.color = proxyRes.ok ? '#10b981' : '#ef4444';
    responseEl.textContent = JSON.stringify(data, null, 2);
    resultEl.style.display = 'block';
  } catch (err) {
    const elapsed = Date.now() - startTime;
    statusEl.textContent = `请求失败 · ${elapsed}ms`;
    statusEl.style.color = '#ef4444';
    responseEl.textContent = err.message;
    resultEl.style.display = 'block';
  }
}

// ===== 数据操作 =====
async function updateDesc(index, desc) {
  try {
    await fetch(`/api/registry/${encodeURIComponent(allRoutes[index].route_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customDescription: desc })
    });
    allRoutes[index].customDescription = desc;
    showToast('描述已更新');
  } catch (err) { console.error('更新失败:', err); }
}

async function addTag(index) {
  const input = document.getElementById('newTagInput');
  const tag = input.value.trim();
  if (!tag) return;
  if (!allRoutes[index].tags) allRoutes[index].tags = [];
  allRoutes[index].tags.push(tag);
  input.value = '';
  await fetch(`/api/registry/${encodeURIComponent(allRoutes[index].route_id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: allRoutes[index].tags })
  });
  viewDetail(index);
  showToast('标签已添加');
}

async function removeTag(index, tagIndex) {
  allRoutes[index].tags.splice(tagIndex, 1);
  await fetch(`/api/registry/${encodeURIComponent(allRoutes[index].route_id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: allRoutes[index].tags })
  });
  viewDetail(index);
}

async function toggleFavorite(index) {
  const newValue = !allRoutes[index].favorite;
  await fetch(`/api/registry/${encodeURIComponent(allRoutes[index].route_id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ favorite: newValue })
  });
  allRoutes[index].favorite = newValue;
  renderList();
  showToast(newValue ? '已收藏' : '已取消收藏');
}

async function updateFrontendStatus(index, value) {
  await fetch(`/api/registry/${encodeURIComponent(allRoutes[index].route_id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frontendStatus: value })
  });
  allRoutes[index].frontendStatus = value;
  const fs = frontendStatusLabels[value];
  renderList();
  updateStats();
  renderDashboard();
  showToast(`前端状态已更新为 ${fs.icon} ${fs.label}`);
}

// ===== 刷新获取新增接口 =====
async function refreshRoutes() {
  try {
    showToast('🔍 扫描 yuwang 源码中...');

    // 1. 扫描 yuwang 代码
    const scanRes = await fetch('/api/scan', { credentials: 'include' });
    if (!scanRes.ok) throw new Error('扫描失败');
    const scanData = await scanRes.json();

    if (scanData.newCount > 0) {
      // 2. 有新接口，合并到 registry
      showToast(`🆕 发现 ${scanData.newCount} 个新接口，合并中...`);
      const syncRes = await fetch('/api/sync-changes', {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ added: scanData.newRoutes })
      });
      if (!syncRes.ok) throw new Error('合并失败');
    }

    // 3. 重新加载 registry
    const regRes = await fetch('/api/registry', { credentials: 'include' });
    if (!regRes.ok) throw new Error('获取 registry 失败');
    allRoutes = await regRes.json();
    localStorage.setItem('apiRegistry', JSON.stringify(allRoutes));

    renderList();
    updateStats();
    renderDashboard();
    if (currentTab === 'perm') renderPermissionMatrix();

    if (scanData.newCount > 0) {
      showToast(`🆕 已添加 ${scanData.newCount} 个新接口：${scanData.newRoutes.map(r => r.path).join(', ')}`);
    } else {
      showToast(`✅ 已是最新，源码共 ${scanData.scanned} 个接口，无新增`);
    }
  } catch (err) {
    showToast('❌ 刷新失败: ' + err.message);
  }
}

// ===== 导出 =====
function openExportModal() {
  const md = buildMarkdown(allRoutes);
  downloadFile(md, 'api-docs.md', 'Markdown 文档已下载');
}

function exportOpenAPI() {
  const spec = buildOpenAPI(allRoutes);
  downloadFile(JSON.stringify(spec, null, 2), 'api-docs.json', 'OpenAPI 文档已下载', 'application/json');
}

function exportSelected() {
  if (selectedItems.size === 0) {
    showToast('请先选择要导出的接口');
    return;
  }
  const selectedRoutes = Array.from(selectedItems).map(idx => allRoutes[idx]).filter(Boolean);
  const md = buildMarkdown(selectedRoutes, '（选中）');
  downloadFile(md, 'api-docs-selected.md', `已导出 ${selectedRoutes.length} 个接口`);
}

function buildMarkdown(routes, suffix = '') {
  let md = `# API 接口文档${suffix}\n\n`;
  md += `> 自动生成于 ${new Date().toLocaleString()}\n\n`;
  md += `**总计: ${routes.length} 个接口**\n\n`;

  const grouped = {};
  routes.forEach(route => {
    if (!grouped[route.apiType]) grouped[route.apiType] = [];
    grouped[route.apiType].push(route);
  });

  Object.entries(grouped).forEach(([type, items]) => {
    md += `## ${typeLabels[type] || type} (${items.length})\n\n`;
    items.forEach(route => {
      md += `### ${route.method} ${route.path}\n\n`;
      md += `- **名称**: ${route.name}\n`;
      md += `- **风险等级**: ${route.riskLevel}\n`;
      md += `- **前端调用**: ${route.frontendUsage.length > 0 ? route.frontendUsage.join(', ') : '未接入'}\n`;
      md += `- **数据库表**: ${route.dbTables.length > 0 ? route.dbTables.join(', ') : '无'}\n`;
      md += '\n---\n\n';
    });
  });
  return md;
}

function buildOpenAPI(routes) {
  const paths = {};
  routes.forEach(route => {
    const path = route.path.replace(/:(\w+)/g, '{$1}'); // Express :id → OpenAPI {id}
    if (!paths[path]) paths[path] = {};
    const method = route.method.toLowerCase();
    const tags = route.module ? [route.module] : [];
    paths[path][method] = {
      summary: route.name,
      description: route.description || '',
      tags,
      operationId: `${method}_${path.replace(/[{}\/]/g, '_')}`,
      responses: { '200': { description: '成功' } }
    };
    if (route.authType === 'user') {
      paths[path][method].security = [{ bearerAuth: [] }];
    }
  });

  return {
    openapi: '3.0.3',
    info: {
      title: 'API 接口文档',
      description: `自动生成于 ${new Date().toLocaleString()}，共 ${routes.length} 个接口`,
      version: '1.0.0'
    },
    servers: [{ url: 'http://localhost:3001', description: '本地开发' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      }
    }
  };
}

function downloadFile(content, filename, toastMsg, mimeType = 'text/markdown') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast(toastMsg);
}

// ===== 批量选择 =====
function toggleItem(idx) {
  const item = document.getElementById(`api-item-${idx}`);
  const checkbox = item.querySelector('input[type="checkbox"]');
  if (checkbox.checked) {
    selectedItems.add(idx);
    item.classList.add('selected');
  } else {
    selectedItems.delete(idx);
    item.classList.remove('selected');
  }
  updateSelectAllState();
}

function toggleSelectAll() {
  const selectAllCheckbox = document.getElementById('selectAll');
  const checkboxes = document.querySelectorAll('#apiList input[type="checkbox"]');
  checkboxes.forEach(cb => {
    const idx = parseInt(cb.dataset.idx);
    cb.checked = selectAllCheckbox.checked;
    const item = document.getElementById(`api-item-${idx}`);
    if (selectAllCheckbox.checked) {
      selectedItems.add(idx);
      item.classList.add('selected');
    } else {
      selectedItems.delete(idx);
      item.classList.remove('selected');
    }
  });
}

function updateSelectAllState() {
  const selectAllCheckbox = document.getElementById('selectAll');
  const checkboxes = document.querySelectorAll('#apiList input[type="checkbox"]');
  const checkedCount = document.querySelectorAll('#apiList input[type="checkbox"]:checked').length;
  selectAllCheckbox.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
  selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

// ===== 工具函数 =====
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2000);
}

// ===== 初始化 =====
// (init moved to end of file with loadManagerConfig)

let claudeTaskRouteIds = [];
let aiTaskEnabled = false;
let latestGeneratedDraft = null;
let claudeSelectedSet = new Set();

async function loadManagerConfig() {
  try { const r = await fetch('/api/manager/config', { credentials: 'include' }); const d = await r.json(); aiTaskEnabled = Boolean(d.aiTasksEnabled);
    const btn=document.getElementById('aiGenerateBtn'); if (btn) btn.style.display = aiTaskEnabled ? 'inline-block' : 'none';
    const btn2=document.getElementById('claudeAiBtn'); if (btn2) btn2.style.display = aiTaskEnabled ? 'inline-block' : 'none';
  } catch {}
}



checkAuth().then(ok => { if (ok) { hideLoginPage(); loadData(); loadManagerConfig(); } });

// ===== Claude 任务生成器 - 独立页面 =====
function renderClaudeRouteList() {
  const search = (document.getElementById('claudeRouteSearch')?.value || '').toLowerCase();
  const modFilter = document.getElementById('claudeModuleFilter')?.value || '';
  const filtered = allRoutes.filter(r => {
    if (modFilter && r.module !== modFilter) return false;
    if (search && !r.path.toLowerCase().includes(search) && !r.name.toLowerCase().includes(search)) return false;
    return true;
  });
  const el = document.getElementById('claudeRouteList');
  if (!el) return;
  el.innerHTML = filtered.map(r => {
    const checked = claudeSelectedSet.has(r.route_id) ? 'checked' : '';
    const fs = frontendStatusLabels[r.frontendStatus] || frontendStatusLabels.needs_review;
    return `<label style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;cursor:pointer;font-size:12px;${checked ? 'background:#eff6ff' : ''}" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='${checked ? '#eff6ff' : 'transparent'}'">
      <input type="checkbox" ${checked} onchange="claudeToggleRoute('${r.route_id}')" style="width:14px;height:14px" />
      <span class="method-badge ${r.method.toLowerCase()}" style="font-size:10px;padding:1px 5px">${r.method}</span>
      <span style="flex:1;font-family:monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.path}</span>
      <span class="frontend-status ${fs.cls}" style="font-size:9px;padding:1px 4px">${fs.icon}</span>
    </label>`;
  }).join('') || '<div style="text-align:center;padding:20px;color:#9ca3af;font-size:13px">无匹配接口</div>';
  updateClaudeSelectedCount();
  // 填充模块下拉
  const modSelect = document.getElementById('claudeModuleFilter');
  if (modSelect && modSelect.options.length <= 1) {
    const mods = [...new Set(allRoutes.map(r => r.module).filter(Boolean))].sort();
    mods.forEach(m => { const opt = document.createElement('option'); opt.value = m; const mm = MODULE_MAP[m]; opt.textContent = mm ? `${mm.icon} ${mm.name}` : m; modSelect.appendChild(opt); });
  }
}

function claudeToggleRoute(routeId) {
  if (claudeSelectedSet.has(routeId)) claudeSelectedSet.delete(routeId); else claudeSelectedSet.add(routeId);
  renderClaudeRouteList();
}

function claudeSelectByModule() {
  const mod = document.getElementById('claudeModuleFilter').value;
  if (!mod) return showToast('请先选择一个模块');
  allRoutes.filter(r => r.module === mod).forEach(r => claudeSelectedSet.add(r.route_id));
  renderClaudeRouteList();
  showToast(`已选 ${mod} 模块全部接口`);
}

function claudeSelectPlanned() {
  allRoutes.filter(r => r.frontendStatus === 'planned').forEach(r => claudeSelectedSet.add(r.route_id));
  renderClaudeRouteList();
  showToast('已选全部规划中接口');
}

function claudeClearSelection() {
  claudeSelectedSet.clear();
  renderClaudeRouteList();
}

function updateClaudeSelectedCount() {
  const el = document.getElementById('claudeSelectedCount');
  if (el) el.textContent = claudeSelectedSet.size;
}

function getClaudePayload() {
  const routeIds = Array.from(claudeSelectedSet);
  if (!routeIds.length) throw new Error('请先选择接口');
  // 生命周期检查：deprecated/removed 接口不能生成任务
  if (typeof canGenerateTask === 'function') {
    for (const rid of routeIds) {
      const route = allRoutes.find(r => (r.route_id || `${r.method}:${r.path}`) === rid);
      if (route) {
        const check = canGenerateTask(route);
        if (!check.ok) throw new Error(check.reason);
      }
    }
  }
  return {
    routeIds,
    targetClient: document.getElementById('claudeTargetClient').value,
    featureName: document.getElementById('claudeFeatureName').value || '前端任务接入'
  };
}

async function generateClaudeTemplate() {
  try {
    const payload = getClaudePayload();
    const res = await fetch('/api/claude-tasks/generate-template', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    latestGeneratedDraft = data.draft;
    document.getElementById('claudePromptPreview').value = data.draft.generatedPrompt || '';
    showToast(data.reused ? '📄 已更新现有草稿' : '📄 模板任务生成成功');
  } catch (e) { showToast('❌ ' + e.message); }
}

async function generateClaudeAi() {
  const btn = document.getElementById('claudeAiBtn');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ AI 生成中...';
  btn.style.opacity = '0.7';
  btn.style.cursor = 'wait';
  try {
    const payload = getClaudePayload();
    const res = await fetch('/api/claude-tasks/generate-ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    latestGeneratedDraft = data.draft;
    document.getElementById('claudePromptPreview').value = data.draft.generatedPrompt || '';
    showToast(data.reused ? '🤖 已更新现有草稿' : '🤖 AI 任务生成成功');
  } catch (e) { showToast('❌ ' + e.message); }
  finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
    btn.style.opacity = '';
    btn.style.cursor = '';
  }
}

function copyClaudePrompt() {
  const el = document.getElementById('claudePromptPreview');
  if (!el.value) return showToast('请先生成任务');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(el.value).then(() => showToast('📋 已复制到剪贴板')).catch(() => fallbackCopy(el));
  } else {
    fallbackCopy(el);
  }
}
function fallbackCopy(el) { el.select(); document.execCommand('copy'); showToast('📋 已复制到剪贴板'); }

async function saveClaudeDraft() {
  if (!latestGeneratedDraft) return showToast('请先生成任务');
  const title = document.getElementById('claudeFeatureName').value || latestGeneratedDraft.title;
  const prompt = document.getElementById('claudePromptPreview').value;
  await fetch(`/api/claude-tasks/${encodeURIComponent(latestGeneratedDraft.id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title, generatedPrompt: prompt,
      routeIds: latestGeneratedDraft.routeIds,
      source: latestGeneratedDraft.source,
      modelName: latestGeneratedDraft.modelName,
      targetClient: latestGeneratedDraft.targetClient,
      structuredContext: latestGeneratedDraft.structuredContext
    })
  });
  showToast('💾 草稿已保存');
  loadClaudeDrafts();
}

// ===== 草稿列表 =====
let selectedDraftIds = new Set();

async function loadClaudeDrafts() {
  try {
    selectedDraftIds.clear();
    updateDraftSelectionUI();
    const res = await fetch('/api/claude-tasks');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    renderClaudeDrafts(data.drafts || []);
  } catch (e) {
    console.error('加载草稿失败:', e);
    document.getElementById('claudeDraftsList').innerHTML = '<div style="color:#ef4444;text-align:center;padding:20px;font-size:13px">加载失败</div>';
  }
}

function updateDraftSelectionUI() {
  const count = selectedDraftIds.size;
  const countEl = document.getElementById('draftSelectedCount');
  const batchBtn = document.getElementById('draftBatchDeleteBtn');
  if (count > 0) {
    countEl.style.display = 'inline';
    countEl.textContent = `已选 ${count}`;
    batchBtn.style.display = 'inline-block';
  } else {
    countEl.style.display = 'none';
    batchBtn.style.display = 'none';
  }
}

function toggleDraftSelect(id) {
  if (selectedDraftIds.has(id)) {
    selectedDraftIds.delete(id);
  } else {
    selectedDraftIds.add(id);
  }
  updateDraftSelectionUI();
  // 更新复选框样式
  const cb = document.getElementById('cb-' + id);
  if (cb) {
    cb.style.background = selectedDraftIds.has(id) ? '#3b82f6' : 'white';
    cb.style.borderColor = selectedDraftIds.has(id) ? '#3b82f6' : '#d1d5db';
    cb.innerHTML = selectedDraftIds.has(id) ? '<span style="color:white;font-size:10px;line-height:1">✓</span>' : '';
  }
}

function renderClaudeDrafts(drafts) {
  const container = document.getElementById('claudeDraftsList');
  if (!drafts.length) {
    container.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:20px;font-size:13px">暂无草稿</div>';
    return;
  }
  const sourceLabel = { template: '📄 模板', ai: '🤖 AI', deepseek: '🤖 deepseek', manual: '✏️ 手动' };
  const statusLabel = { draft: '草稿', accepted: '已采纳', copied: '已复制', archived: '已归档' };
  const statusColor = { draft: '#6b7280', accepted: '#10b981', copied: '#3b82f6', archived: '#9ca3af' };
  container.innerHTML = drafts.map(d => {
    const date = new Date(d.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const promptPreview = (d.generatedPrompt || '').substring(0, 80).replace(/\n/g, ' ');
    const checked = selectedDraftIds.has(d.id);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;transition:background 0.15s" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='white'">
      <div id="cb-${d.id}" onclick="toggleDraftSelect('${d.id}')" style="width:18px;height:18px;border:2px solid ${checked ? '#3b82f6' : '#d1d5db'};border-radius:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${checked ? '#3b82f6' : 'white'}">${checked ? '<span style="color:white;font-size:10px;line-height:1">✓</span>' : ''}</div>
      <div style="flex:1;min-width:0;cursor:pointer" onclick="previewDraft('${d.id}')">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-weight:600;font-size:13px;color:#1f2937">${d.title || '未命名'}</span>
          <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${statusColor[d.status] || '#6b7280'}20;color:${statusColor[d.status] || '#6b7280'}">${statusLabel[d.status] || d.status}</span>
          <span style="font-size:11px;color:#9ca3af">${sourceLabel[d.source] || d.source}</span>
        </div>
        <div style="font-size:11px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${promptPreview}...</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
        <span style="font-size:11px;color:#9ca3af">${date}</span>
        <button class="btn-icon" title="下载" onclick="downloadDraft('${d.id}')">📥</button>
        <button class="btn-icon" title="删除" onclick="deleteDraft('${d.id}')">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

let currentPreviewDraft = null;

async function previewDraft(id) {
  try {
    const res = await fetch('/api/claude-tasks');
    const data = await res.json();
    const draft = (data.drafts || []).find(d => d.id === id);
    if (!draft) return showToast('❌ 草稿不存在');
    currentPreviewDraft = draft;
    document.getElementById('draftPreviewTitle').textContent = `📄 ${draft.title || '未命名'}`;
    document.getElementById('draftPreviewContent').value = draft.generatedPrompt || '';
    document.getElementById('draftPreviewModal').style.display = 'flex';
  } catch (e) { showToast('❌ ' + e.message); }
}

function closeDraftPreview() {
  document.getElementById('draftPreviewModal').style.display = 'none';
  currentPreviewDraft = null;
}

function copyDraftPreview() {
  const el = document.getElementById('draftPreviewContent');
  if (!el.value) return showToast('没有内容');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(el.value).then(() => showToast('📋 已复制到剪贴板')).catch(() => { el.select(); document.execCommand('copy'); showToast('📋 已复制'); });
  } else {
    el.select(); document.execCommand('copy'); showToast('📋 已复制');
  }
}

function loadDraftToEditor() {
  if (!currentPreviewDraft) return;
  document.getElementById('claudePromptPreview').value = currentPreviewDraft.generatedPrompt || '';
  document.getElementById('claudeFeatureName').value = currentPreviewDraft.title || '';
  latestGeneratedDraft = currentPreviewDraft;
  closeDraftPreview();
  showToast('📝 已加载到编辑器');
}

function downloadDraft(id) {
  fetch('/api/claude-tasks').then(r => r.json()).then(data => {
    const draft = (data.drafts || []).find(d => d.id === id);
    if (!draft) return showToast('❌ 草稿不存在');
    const content = draft.generatedPrompt || '';
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${draft.title || '草稿'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📥 已下载草稿');
  }).catch(e => showToast('❌ ' + e.message));
}

async function deleteDraft(id) {
  if (!confirm('确定删除此草稿？')) return;
  try {
    const res = await fetch(`/api/claude-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showToast('🗑️ 草稿已删除');
    loadClaudeDrafts();
  } catch (e) { showToast('❌ ' + e.message); }
}

async function batchDeleteDrafts() {
  if (!selectedDraftIds.size) return showToast('请先选择草稿');
  if (!confirm(`确定删除选中的 ${selectedDraftIds.size} 个草稿？`)) return;
  try {
    const ids = [...selectedDraftIds];
    const results = await Promise.all(ids.map(id =>
      fetch(`/api/claude-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(r => r.json())
    ));
    const failed = results.filter(r => !r.success);
    if (failed.length) {
      showToast(`⚠️ ${failed.length} 个删除失败`);
    } else {
      showToast(`🗑️ 已删除 ${ids.length} 个草稿`);
    }
    loadClaudeDrafts();
  } catch (e) { showToast('❌ ' + e.message); }
}

async function clearAllDrafts() {
  if (!confirm('⚠️ 确定清空所有草稿？此操作不可撤销！')) return;
  try {
    const res = await fetch('/api/claude-tasks');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    const ids = (data.drafts || []).map(d => d.id);
    if (!ids.length) return showToast('没有草稿可清空');
    await Promise.all(ids.map(id =>
      fetch(`/api/claude-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
    ));
    showToast(`🔥 已清空 ${ids.length} 个草稿`);
    loadClaudeDrafts();
  } catch (e) { showToast('❌ ' + e.message); }
}

// ===== 权限矩阵 =====
async function renderPermissionMatrix() {
  // 如果数据未加载，先拉取
  if (!allRoutes || !allRoutes.length) {
    try {
      const res = await fetch('/api/registry');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) allRoutes = data;
      }
    } catch {}
  }
  if (!allRoutes || !allRoutes.length) {
    document.getElementById('permMatrix').innerHTML = '<div style="text-align:center;padding:40px;color:#9ca3af">暂无数据，请先刷新接口列表</div>';
    return;
  }

  const AUTH_LEVELS = [
    { key: 'anonymous', label: '匿名', cls: 'anon' },
    { key: 'user', label: '登录用户', cls: 'user' },
    { key: 'admin', label: '管理员', cls: 'admin' }
  ];

  // Build matrix: module → { anonymous: N, user: N, admin: N, internal: N, total: N }
  const matrix = {};
  const anomalies = [];
  const mismatchApis = [];
  const exposedInternal = [];

  allRoutes.forEach(route => {
    const mod = route.module || 'other';
    if (!matrix[mod]) matrix[mod] = { anonymous: 0, user: 0, admin: 0, internal: 0, total: 0 };
    const at = route.authType || 'anonymous';
    if (matrix[mod][at] !== undefined) matrix[mod][at]++;
    else matrix[mod].admin++;
    matrix[mod].total++;

    // Anomaly: authType vs apiType mismatch
    if (at === 'admin' && route.apiType === 'public') {
      mismatchApis.push({ route, reason: '管理接口被声明为公开' });
    } else if (at === 'user' && route.apiType === 'public') {
      mismatchApis.push({ route, reason: '用户接口被声明为公开' });
    } else if (at === 'anonymous' && route.apiType === 'admin') {
      mismatchApis.push({ route, reason: '匿名接口被声明为管理' });
    }

    // Internal: no frontend usage, not admin module, not system
    const noFrontend = !route.frontendUsage || route.frontendUsage.length === 0;
    const isAdminPath = route.path.startsWith('/api/admin/');
    if (noFrontend && mod !== 'admin' && mod !== 'system' && !isAdminPath) {
      exposedInternal.push(route);
      matrix[mod].internal++;
    }
  });

  // Categorize anomalies
  const criticalApis = mismatchApis.filter(a => a.route.authType === 'admin' && a.route.apiType === 'public');
  const warningApis = mismatchApis.filter(a => a.route.authType === 'user' && a.route.apiType === 'public');
  const infoApis = mismatchApis.filter(a => a.route.authType === 'anonymous' && a.route.apiType === 'admin');

  if (criticalApis.length) anomalies.push({ level: 'critical', icon: '🚨', title: `${criticalApis.length} 个管理接口被声明为公开`, apis: criticalApis });
  if (warningApis.length) anomalies.push({ level: 'warning', icon: '⚠️', title: `${warningApis.length} 个用户接口被声明为公开`, apis: warningApis });
  if (infoApis.length) anomalies.push({ level: 'info', icon: '💡', title: `${infoApis.length} 个匿名接口被声明为管理`, apis: infoApis });
  if (exposedInternal.length) anomalies.push({ level: 'info', icon: '👁️', title: `${exposedInternal.length} 个接口无前端调用记录（可能暴露）`, apis: exposedInternal.map(r => ({ route: r, reason: '无前端调用' })) });

  // Update stat badges
  document.getElementById('anomalyCount').textContent = `异常: ${criticalApis.length}`;
  document.getElementById('mismatchCount').textContent = `不一致: ${warningApis.length + infoApis.length}`;
  const normalCount = allRoutes.length - criticalApis.length - warningApis.length - infoApis.length;
  document.getElementById('cleanCount').textContent = `正常: ${normalCount}`;

  // Render anomaly alerts
  const alertsHtml = anomalies.map(a => `
    <div class="anomaly-alert ${a.level}">
      <span class="alert-icon">${a.icon}</span>
      <div class="alert-body">
        <div class="alert-title">${a.title}</div>
        <div class="alert-apis">
          ${a.apis.slice(0, 8).map(item => `<span class="alert-api-item">${item.route.method} ${item.route.path}</span>`).join('')}
          ${a.apis.length > 8 ? `<span style="color:#9ca3af;font-size:11px">+${a.apis.length - 8} 更多</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');
  document.getElementById('anomalyAlerts').innerHTML = alertsHtml || '<div style="text-align:center;padding:20px;color:#10b981;font-size:14px">✅ 未发现权限异常</div>';

  // Render matrix table
  const activeModules = MODULE_ORDER.filter(key => matrix[key]);
  Object.keys(matrix).forEach(key => {
    if (!activeModules.includes(key)) activeModules.push(key);
  });

  const tableHtml = `
    <table class="perm-table">
      <thead>
        <tr>
          <th>模块</th>
          ${AUTH_LEVELS.map(al => `<th>${al.label}</th>`).join('')}
          <th>内部</th>
          <th style="color:#9ca3af;font-weight:400">合计</th>
        </tr>
      </thead>
      <tbody>
        ${activeModules.map(key => {
          const m = matrix[key];
          const mod = MODULE_MAP[key] || MODULE_MAP['other'];
          const hasAnomaly = mismatchApis.some(a => (a.route.module || 'other') === key);
          const rowStyle = hasAnomaly ? 'background:#fff7ed' : '';
          return `
            <tr style="${rowStyle}">
              <td class="module-name"><span class="module-icon">${mod.icon}</span>${mod.name}</td>
              ${AUTH_LEVELS.map(al => {
                const val = m[al.key] || 0;
                const cls = val > 0 ? al.cls : 'zero';
                return `<td><span class="perm-cell ${cls}">${val}</span></td>`;
              }).join('')}
              <td><span class="perm-cell ${m.internal > 0 ? 'internal' : 'zero'}">${m.internal}</span></td>
              <td style="color:#9ca3af;font-size:12px">${m.total}</td>
            </tr>
          `;
        }).join('')}
        <tr style="background:#f9fafb;font-weight:600">
          <td class="module-name">📊 合计</td>
          ${AUTH_LEVELS.map(al => {
            const total = activeModules.reduce((s, k) => s + (matrix[k][al.key] || 0), 0);
            return `<td><span class="perm-cell ${al.cls}">${total}</span></td>`;
          }).join('')}
          <td><span class="perm-cell internal">${activeModules.reduce((s, k) => s + matrix[k].internal, 0)}</span></td>
          <td style="color:#6b7280;font-size:12px">${allRoutes.length}</td>
        </tr>
      </tbody>
    </table>
  `;
  document.getElementById('permMatrix').innerHTML = tableHtml;
}

// ===== 功能包 =====
let featurePacks = [];
let editingPackId = null;

const PACK_STATUSES = [
  { key: '待规划', icon: '📋', color: '#6b7280' },
  { key: '后端已完成', icon: '⚙️', color: '#8b5cf6' },
  { key: '接口已验证', icon: '✅', color: '#3b82f6' },
  { key: '前端任务已生成', icon: '🤖', color: '#06b6d4' },
  { key: '前端开发中', icon: '🔨', color: '#f59e0b' },
  { key: '待验收', icon: '🧪', color: '#ef4444' },
  { key: '已完成', icon: '🎉', color: '#10b981' },
  { key: '暂停', icon: '⏸️', color: '#9ca3af' },
  { key: '废弃', icon: '🗑️', color: '#d1d5db' }
];

const ACCEPTANCE_LABELS = {
  not_started: { text: '未开始', color: '#9ca3af' },
  pending_test: { text: '待测试', color: '#f59e0b' },
  passed: { text: '已通过', color: '#10b981' },
  failed: { text: '未通过', color: '#ef4444' }
};

const CLAUDE_LABELS = {
  not_generated: { text: '未生成', color: '#9ca3af' },
  generated: { text: '已生成', color: '#10b981' },
  in_progress: { text: '进行中', color: '#f59e0b' }
};

async function loadFeaturePacks() {
  try {
    const res = await fetch('/api/feature-packs', { credentials: 'include' });
    const data = await res.json();
    if (data.success) featurePacks = data.packs || [];
    renderKanban();
  } catch (e) {
    console.error('加载功能包失败:', e);
  }
}

function renderKanban() {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;

  const html = PACK_STATUSES.map(status => {
    const packs = featurePacks.filter(p => p.status === status.key);
    const cardsHtml = packs.length ? packs.map(p => renderPackCard(p)).join('') :
      '<div class="kanban-empty">暂无功能包</div>';
    return `
      <div class="kanban-column" data-status="${status.key}">
        <div class="kanban-column-header">
          <span class="kanban-column-title">${status.icon} ${status.key}</span>
          <span class="kanban-column-count">${packs.length}</span>
        </div>
        <div class="kanban-cards">${cardsHtml}</div>
      </div>
    `;
  }).join('');

  board.innerHTML = html;
}

function renderPackCard(pack) {
  const acceptance = ACCEPTANCE_LABELS[pack.acceptanceStatus] || ACCEPTANCE_LABELS.not_started;
  const claude = CLAUDE_LABELS[pack.claudeStatus] || CLAUDE_LABELS.not_generated;
  const targetLabel = pack.targetClient === 'admin' ? '🔧 管理后台' : '🖥️ 用户前台';
  const routeCount = (pack.routes || []).length;

  const routeTags = (pack.routes || []).slice(0, 4).map(r => {
    if (typeof r === 'string') return `<span>${r}</span>`;
    return `<span>${r.method || ''} ${r.path || r}</span>`;
  }).join('');
  const moreRoutes = routeCount > 4 ? `<span>+${routeCount - 4}</span>` : '';

  return `
    <div class="kanban-card" onclick="editPack('${pack.id}')">
      <div class="kanban-card-title">${pack.name}</div>
      ${pack.description ? `<div class="kanban-card-desc">${pack.description}</div>` : ''}
      <div class="kanban-card-meta">
        <span class="kanban-tag kt-target">${targetLabel}</span>
        <span class="kanban-tag kt-routes">📎 ${routeCount} 接口</span>
        <span class="kanban-tag kt-claude ${pack.claudeStatus === 'not_generated' ? 'not' : ''}">🤖 ${claude.text}</span>
        <span class="kanban-tag kt-accept ${pack.acceptanceStatus === 'passed' ? 'passed' : ''} ${pack.acceptanceStatus === 'failed' ? 'failed' : ''}">${acceptance.text}</span>
      </div>
      ${routeCount > 0 ? `<div class="kanban-card-routes">${routeTags}${moreRoutes}</div>` : ''}
      <div class="kanban-card-actions">
        <button class="btn-icon" onclick="event.stopPropagation();editPack('${pack.id}')" title="编辑">✏️</button>
        <button class="btn-icon" onclick="event.stopPropagation();quickStatusPack('${pack.id}')" title="快速改状态">🔄</button>
        <button class="btn-icon" onclick="event.stopPropagation();deletePack('${pack.id}')" title="删除">🗑️</button>
      </div>
    </div>
  `;
}

function openPackModal(packId) {
  editingPackId = packId || null;
  const modal = document.getElementById('packModal');
  const title = document.getElementById('packModalTitle');

  if (packId) {
    const pack = featurePacks.find(p => p.id === packId);
    if (!pack) return;
    title.textContent = '✏️ 编辑功能包';
    document.getElementById('packName').value = pack.name;
    document.getElementById('packDesc').value = pack.description || '';
    document.getElementById('packStatus').value = pack.status;
    document.getElementById('packTargetClient').value = pack.targetClient || 'user';
    document.getElementById('packAcceptance').value = pack.acceptanceStatus || 'not_started';
    document.getElementById('packNotes').value = pack.notes || '';
  } else {
    title.textContent = '➕ 新建功能包';
    document.getElementById('packName').value = '';
    document.getElementById('packDesc').value = '';
    document.getElementById('packStatus').value = '待规划';
    document.getElementById('packTargetClient').value = 'user';
    document.getElementById('packAcceptance').value = 'not_started';
    document.getElementById('packNotes').value = '';
  }

  renderRouteSelector(packId);
  modal.style.display = 'flex';
}

function closePackModal() {
  document.getElementById('packModal').style.display = 'none';
  editingPackId = null;
}

function editPack(id) {
  openPackModal(id);
}

function renderRouteSelector(packId) {
  const container = document.getElementById('packRouteSelector');
  const pack = packId ? featurePacks.find(p => p.id === packId) : null;
  const selectedRoutes = new Set((pack?.routes || []).map(r => typeof r === 'string' ? r : `${r.method}:${r.path}`));
  const targetClient = document.getElementById('packTargetClient').value;

  if (!allRoutes || !allRoutes.length) {
    container.innerHTML = '<div style="color:#9ca3af;font-size:12px;padding:8px">接口数据未加载，请先刷新</div>';
    return;
  }

  // 按目标端过滤：user 只看 user/anonymous 接口，admin 只看 admin 接口
  const filtered = allRoutes.filter(r => {
    const auth = r.accessOverride || r.detectedAuth || r.authType || 'user';
    if (targetClient === 'admin') return auth === 'admin';
    return auth !== 'admin'; // user: 显示非 admin 的接口
  });

  // Group by module
  const grouped = {};
  filtered.forEach(r => {
    const mod = r.module || 'other';
    if (!grouped[mod]) grouped[mod] = [];
    grouped[mod].push(r);
  });

  let html = '';
  MODULE_ORDER.filter(k => grouped[k]).forEach(mod => {
    const modInfo = MODULE_MAP[mod] || MODULE_MAP['other'];
    html += `<div style="font-size:11px;font-weight:600;color:#6b7280;padding:6px 4px 2px;margin-top:4px">${modInfo.icon} ${modInfo.name}</div>`;
    grouped[mod].forEach(r => {
      const key = `${r.method}:${r.path}`;
      const checked = selectedRoutes.has(key) ? 'checked' : '';
      html += `<label style="display:flex;align-items:center;gap:6px;padding:3px 4px;font-size:12px;cursor:pointer;border-radius:4px" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background=''">
        <input type="checkbox" class="pack-route-cb" value="${key}" ${checked} onchange="updatePackRouteCount()" />
        <span style="font-family:monospace;font-size:11px;color:#374151">${r.method} ${r.path}</span>
        <span style="font-size:10px;color:#9ca3af;margin-left:auto">${r.name || ''}</span>
      </label>`;
    });
  });
  container.innerHTML = html;
  updatePackRouteCount();
}

function updatePackRouteCount() {
  const checked = document.querySelectorAll('.pack-route-cb:checked').length;
  document.getElementById('packRouteCount').textContent = checked;
}

async function savePack() {
  const name = document.getElementById('packName').value.trim();
  if (!name) return showToast('❌ 请输入功能名称');

  const selectedCb = document.querySelectorAll('.pack-route-cb:checked');
  const routes = Array.from(selectedCb).map(cb => {
    const routeId = cb.value;
    const route = allRoutes.find(r => (r.route_id || `${r.method}:${r.path}`) === routeId);
    return { route_id: route.route_id, method: route.method, path: route.path, name: route.name || '' };
  });

  const body = {
    name,
    description: document.getElementById('packDesc').value.trim(),
    status: document.getElementById('packStatus').value,
    targetClient: document.getElementById('packTargetClient').value,
    acceptanceStatus: document.getElementById('packAcceptance').value,
    routes,
    notes: document.getElementById('packNotes').value.trim()
  };

  try {
    let res;
    if (editingPackId) {
      res = await fetch(`/api/feature-packs/${encodeURIComponent(editingPackId)}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } else {
      res = await fetch('/api/feature-packs', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }
    const data = await res.json();
    if (data.success) {
      showToast(editingPackId ? '✅ 已更新' : '✅ 已创建');
      closePackModal();
      loadFeaturePacks();
    } else {
      showToast('❌ ' + (data.message || '保存失败') + (data.errors ? '\n' + data.errors.join('\n') : ''));
    }
  } catch (e) {
    showToast('❌ 网络错误');
  }
}

async function deletePack(id) {
  if (!confirm('确定删除这个功能包？')) return;
  try {
    const res = await fetch(`/api/feature-packs/${encodeURIComponent(id)}`, {
      method: 'DELETE', credentials: 'include'
    });
    const data = await res.json();
    if (data.success) {
      showToast('🗑️ 已删除');
      loadFeaturePacks();
    }
  } catch (e) {
    showToast('❌ 删除失败');
  }
}

async function quickStatusPack(id) {
  const pack = featurePacks.find(p => p.id === id);
  if (!pack) return;
  const statusKeys = PACK_STATUSES.map(s => s.key);
  const currentIdx = statusKeys.indexOf(pack.status);
  const nextStatus = statusKeys[(currentIdx + 1) % statusKeys.length];

  try {
    const res = await fetch(`/api/feature-packs/${encodeURIComponent(id)}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`🔄 ${pack.status} → ${nextStatus}`);
      loadFeaturePacks();
    }
  } catch (e) {
    showToast('❌ 更新失败');
  }
}

// ===== 变更影响分析 =====
function analyzeImpact() {
  const prev = JSON.parse(localStorage.getItem('api-snapshot-full') || '{}');
  const impacts = [];

  // 检测修改和新增
  allRoutes.forEach(route => {
    const key = routeKey(route);
    const prevRoute = prev[key];

    if (!prevRoute) {
      // 新增接口
      impacts.push({
        key, route, type: 'new',
        risk: 'low',
        changes: [{ field: '新增', from: null, to: `${route.method} ${route.path}` }],
        frontendFiles: route.frontendUsage || [],
        affectedPacks: findAffectedPacks(key),
        recommendation: '新增接口，确认前端是否需要接入。'
      });
      return;
    }

    // 逐字段比对
    const changes = [];
    const COMPARE_FIELDS = [
      { key: 'method', label: '请求方法', riskWeight: 10 },
      { key: 'path', label: '接口路径', riskWeight: 10 },
      { key: 'authType', label: '权限类型', riskWeight: 8 },
      { key: 'riskLevel', label: '风险等级', riskWeight: 5 },
      { key: 'apiType', label: '接口类型', riskWeight: 6 },
      { key: 'status', label: '状态', riskWeight: 3 },
      { key: 'module', label: '所属模块', riskWeight: 2 },
      { key: 'name', label: '接口名称', riskWeight: 1 }
    ];

    let totalRisk = 0;
    COMPARE_FIELDS.forEach(f => {
      if (prevRoute[f.key] !== route[f.key]) {
        changes.push({ field: f.label, from: prevRoute[f.key], to: route[f.key] });
        totalRisk += f.riskWeight;
      }
    });

    // 检测前端调用变化
    const prevFiles = new Set(prevRoute.frontendUsage || []);
    const currFiles = new Set(route.frontendUsage || []);
    const addedFiles = [...currFiles].filter(f => !prevFiles.has(f));
    const removedFiles = [...prevFiles].filter(f => !currFiles.has(f));
    addedFiles.forEach(f => changes.push({ field: '前端调用(新增)', from: null, to: f }));
    removedFiles.forEach(f => changes.push({ field: '前端调用(移除)', from: f, to: null }));

    if (changes.length === 0) return;

    // 计算风险
    const hasFrontend = (route.frontendUsage || []).length > 0 || (prevRoute.frontendUsage || []).length > 0;
    const hasPacks = findAffectedPacks(key).length > 0;
    const isMethodPathChange = changes.some(c => c.field === '请求方法' || c.field === '接口路径');
    const isAuthChange = changes.some(c => c.field === '权限类型');

    let risk = 'low';
    if (totalRisk >= 8 || isMethodPathChange) risk = 'high';
    else if (totalRisk >= 4 || isAuthChange) risk = 'medium';

    // 有前端调用或功能包关联 → 风险升级
    if ((hasFrontend || hasPacks) && risk === 'low') risk = 'medium';
    if ((hasFrontend || hasPacks) && risk === 'medium' && (isMethodPathChange || isAuthChange)) risk = 'high';

    impacts.push({
      key, route, type: 'modified', risk, changes,
      frontendFiles: route.frontendUsage || [],
      prevFrontendFiles: prevRoute.frontendUsage || [],
      affectedPacks: findAffectedPacks(key),
      recommendation: generateRecommendation(changes, hasFrontend, hasPacks, risk)
    });
  });

  // 检测删除
  Object.keys(prev).forEach(key => {
    if (!allRoutes.find(r => routeKey(r) === key)) {
      const prevRoute = prev[key];
      impacts.push({
        key, route: prevRoute, type: 'removed',
        risk: (prevRoute.frontendUsage || []).length > 0 ? 'high' : 'medium',
        changes: [{ field: '删除', from: `${prevRoute.method} ${prevRoute.path}`, to: null }],
        frontendFiles: prevRoute.frontendUsage || [],
        affectedPacks: findAffectedPacks(key),
        recommendation: (prevRoute.frontendUsage || []).length > 0
          ? `🚨 接口被删除但仍有 ${prevRoute.frontendUsage.length} 个前端文件在调用！会导致运行时错误。`
          : '接口已删除，确认是否有前端代码需要清理。'
      });
    }
  });

  // 按风险排序：high > medium > low
  const riskOrder = { high: 0, medium: 1, low: 2 };
  impacts.sort((a, b) => (riskOrder[a.risk] ?? 3) - (riskOrder[b.risk] ?? 3));

  return impacts;
}

function findAffectedPacks(routeKey) {
  if (!featurePacks || !featurePacks.length) return [];
  return featurePacks.filter(pack => {
    return (pack.routes || []).some(r => {
      const rk = typeof r === 'string' ? r : `${r.method}:${r.path}`;
      return rk === routeKey;
    });
  });
}

function generateRecommendation(changes, hasFrontend, hasPacks, risk) {
  const parts = [];
  const isMethodPath = changes.some(c => c.field === '请求方法' || c.field === '接口路径');
  const isAuth = changes.some(c => c.field === '权限类型');

  if (risk === 'high') {
    parts.push('🚨 高风险变更');
  }
  if (isMethodPath && hasFrontend) {
    parts.push('路径/方法变更会直接导致前端请求失败，建议先更新前端代码。');
  } else if (isMethodPath) {
    parts.push('路径/方法变更，确认是否有未记录的前端调用。');
  }
  if (isAuth && hasFrontend) {
    parts.push('权限变更可能导致前端出现 401/403 错误。');
  }
  if (hasPacks) {
    parts.push('该接口属于功能包，变更前请确认功能包状态。');
  }
  if (hasFrontend) {
    parts.push(`受影响的前端文件：${changes.length > 0 ? '请查看下方文件列表' : '无变更'}`);
  }
  if (parts.length === 0) {
    parts.push(risk === 'low' ? '低风险变更，建议确认后提交。' : '建议在测试环境验证后再上线。');
  }
  return parts.join(' ');
}

function renderImpactAnalysis() {
  if (!allRoutes || !allRoutes.length) {
    document.getElementById('impactChanges').innerHTML = '<div class="impact-empty"><div class="icon">📭</div><div>暂无数据，请先刷新接口列表</div></div>';
    return;
  }

  const impacts = analyzeImpact();

  // 统计
  const highCount = impacts.filter(i => i.risk === 'high').length;
  const medCount = impacts.filter(i => i.risk === 'medium').length;
  const lowCount = impacts.filter(i => i.risk === 'low').length;
  const affectedFiles = new Set();
  impacts.forEach(i => (i.frontendFiles || []).forEach(f => affectedFiles.add(f)));

  document.getElementById('impactHighCount').textContent = `高风险: ${highCount}`;
  document.getElementById('impactMediumCount').textContent = `中风险: ${medCount}`;
  document.getElementById('impactLowCount').textContent = `低风险: ${lowCount}`;

  // 仪表盘
  document.getElementById('impactDashboard').innerHTML = `
    <div class="health-card info">
      <div class="icon">🔍</div>
      <div class="value">${impacts.length}</div>
      <div class="label">变更总数</div>
    </div>
    <div class="health-card danger">
      <div class="icon">🚨</div>
      <div class="value">${highCount}</div>
      <div class="label">高风险变更</div>
    </div>
    <div class="health-card warning">
      <div class="icon">📂</div>
      <div class="value">${affectedFiles.size}</div>
      <div class="label">受影响前端文件</div>
    </div>
    <div class="health-card success">
      <div class="icon">📦</div>
      <div class="value">${new Set(impacts.flatMap(i => i.affectedPacks.map(p => p.id))).size}</div>
      <div class="label">受影响功能包</div>
    </div>
  `;

  if (impacts.length === 0) {
    document.getElementById('impactChanges').innerHTML = `
      <div class="impact-empty">
        <div class="icon">✅</div>
        <div style="font-size:18px;font-weight:600;color:#10b981;margin-bottom:8px">无变更</div>
        <div>上次扫描以来没有检测到接口变更</div>
      </div>
    `;
    return;
  }

  // 渲染变更卡片
  const html = impacts.map(impact => {
    const typeIcon = { new: '🆕', modified: '✏️', removed: '🗑️' }[impact.type] || '❓';
    const typeLabel = { new: '新增', modified: '修改', removed: '删除' }[impact.type] || '未知';
    const riskLabel = { high: '高风险', medium: '中风险', low: '低风险' }[impact.risk];
    const cardCls = impact.type === 'removed' ? 'removed' : impact.type === 'new' ? 'new' : impact.risk;

    const changesHtml = impact.changes.map(c => {
      const cls = c.from === null ? 'added' : c.to === null ? 'removed' : 'field';
      const text = c.from === null ? `${c.field}: ${c.to}` : c.to === null ? `${c.field}: ${c.from} (已移除)` : `${c.field}: ${c.from} → ${c.to}`;
      return `<span class="impact-change ${cls}">${text}</span>`;
    }).join('');

    const filesHtml = impact.frontendFiles.length > 0
      ? impact.frontendFiles.map(f => `<span class="impact-file">📄 ${f}</span>`).join('')
      : '<span style="font-size:12px;color:#9ca3af">无前端调用记录</span>';

    const packsHtml = impact.affectedPacks.length > 0
      ? impact.affectedPacks.map(p => `<span class="impact-pack">📦 ${p.name}</span>`).join('')
      : '<span style="font-size:12px;color:#9ca3af">未关联功能包</span>';

    const recCls = impact.risk === 'high' ? 'critical' : '';

    return `
      <div class="impact-card ${cardCls}" id="impact-${impact.key}">
        <div class="impact-card-header" onclick="this.parentElement.classList.toggle('open')">
          <div class="impact-card-title">
            ${typeIcon} <code>${impact.route.method || ''} ${impact.route.path || impact.key}</code>
            <span style="font-size:12px;color:#6b7280;font-weight:400">${impact.route.name || ''}</span>
          </div>
          <span class="impact-risk-badge ${impact.risk}">${riskLabel}</span>
        </div>
        <div class="impact-card-body">
          <div class="impact-section">
            <div class="impact-section-title">📋 变更内容</div>
            <div class="impact-change-list">${changesHtml}</div>
          </div>
          <div class="impact-section">
            <div class="impact-section-title">📂 受影响前端文件</div>
            <div class="impact-file-list">${filesHtml}</div>
          </div>
          <div class="impact-section">
            <div class="impact-section-title">📦 关联功能包</div>
            <div class="impact-pack-list">${packsHtml}</div>
          </div>
          <div class="impact-recommendation ${recCls}">${impact.recommendation}</div>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('impactChanges').innerHTML = html;
}

function refreshImpactAnalysis() {
  // 重新加载数据后分析
  loadData().then(() => {
    renderImpactAnalysis();
    showToast('✅ 影响分析已刷新');
  });
}

// ===== 重复接口识别 =====

// 路径标准化：把参数段替换为占位符
function normalizePath(path) {
  return path
    .replace(/\/[0-9a-f]{24}/g, '/:id')        // MongoDB ObjectId
    .replace(/\/\d+/g, '/:id')                   // 数字 ID
    .replace(/\/:[a-zA-Z_]+/g, '/:param')        // 命名参数
    .replace(/\/\{[a-zA-Z_]+\}/g, '/:param')     // OpenAPI 参数
    .toLowerCase();
}

// 简单编辑距离（用于名称相似度）
function editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

// 名称相似度（0-1）
function nameSimilarity(a, b) {
  const na = a.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const nb = b.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  if (!na || !nb) return 0;
  const dist = editDistance(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

// 中文名称关键词提取
function extractKeywords(name) {
  const cn = name.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const en = name.match(/[a-z]{3,}/gi) || [];
  return [...cn, ...en.map(w => w.toLowerCase())];
}

function runDedupAnalysis() {
  if (!allRoutes || !allRoutes.length) {
    document.getElementById('dedupResults').innerHTML = '<div style="text-align:center;padding:60px;color:#9ca3af">暂无数据，请先刷新接口列表</div>';
    return;
  }

  const groups = [];

  // 1. 路径相似检测
  const pathGroups = {};
  allRoutes.forEach(r => {
    const norm = normalizePath(r.path);
    if (!pathGroups[norm]) pathGroups[norm] = [];
    pathGroups[norm].push(r);
  });
  Object.entries(pathGroups).forEach(([norm, routes]) => {
    if (routes.length >= 2) {
      // 过滤：同一 method 同一标准化路径不算重复（那是正常的一对多）
      // 只有不同原始路径或不同 method 才算
      const uniquePaths = new Set(routes.map(r => `${r.method} ${r.path}`));
      if (uniquePaths.size >= 2) {
        groups.push({ type: 'path', label: '路径相似', routes, norm });
      }
    }
  });

  // 2. 名称相似检测（跨模块）
  const usedInPath = new Set(groups.flatMap(g => g.routes.map(r => routeKey(r))));
  for (let i = 0; i < allRoutes.length; i++) {
    for (let j = i + 1; j < allRoutes.length; j++) {
      const a = allRoutes[i], b = allRoutes[j];
      const ka = routeKey(a), kb = routeKey(b);
      if (usedInPath.has(ka) && usedInPath.has(kb)) continue;
      if (a.name && b.name && nameSimilarity(a.name, b.name) > 0.6 && ka !== kb) {
        // 检查是否已被其他组包含
        const alreadyGrouped = groups.some(g => g.routes.some(r => routeKey(r) === ka) && g.routes.some(r => routeKey(r) === kb));
        if (!alreadyGrouped) {
          groups.push({ type: 'name', label: '名称相似', routes: [a, b], similarity: nameSimilarity(a.name, b.name) });
        }
      }
    }
  }

  // 3. 同模块功能重叠检测
  const moduleRoutes = {};
  allRoutes.forEach(r => {
    const mod = r.module || 'other';
    if (!moduleRoutes[mod]) moduleRoutes[mod] = [];
    moduleRoutes[mod].push(r);
  });
  Object.entries(moduleRoutes).forEach(([mod, routes]) => {
    if (routes.length < 3) return;
    // 找同一模块下 GET 接口过多的情况（可能有功能重叠）
    const getRoutes = routes.filter(r => r.method === 'GET');
    if (getRoutes.length >= 4) {
      const unusedGets = getRoutes.filter(r => (!r.frontendUsage || r.frontendUsage.length === 0));
      if (unusedGets.length >= 2) {
        const alreadyIncluded = unusedGets.every(r => groups.some(g => g.routes.some(gr => routeKey(gr) === routeKey(r))));
        if (!alreadyIncluded) {
          const modInfo = MODULE_MAP[mod] || MODULE_MAP['other'];
          groups.push({ type: 'module', label: `${modInfo.icon} ${modInfo.name} 冗余`, routes: unusedGets, module: mod });
        }
      }
    }
  });

  // 4. 疑似废弃接口
  const allGroupedKeys = new Set(groups.flatMap(g => g.routes.map(r => routeKey(r))));
  const unusedRoutes = allRoutes.filter(r => {
    const key = routeKey(r);
    if (allGroupedKeys.has(key)) return false;
    const noFrontend = !r.frontendUsage || r.frontendUsage.length === 0;
    const noPacks = !featurePacks || !featurePacks.length || !featurePacks.some(p => (p.routes || []).some(pr => (typeof pr === 'string' ? pr : `${pr.method}:${pr.path}`) === key));
    const notAdmin = !r.path.startsWith('/api/admin/');
    const notSystem = r.module !== 'system';
    return noFrontend && noPacks && notAdmin && notSystem;
  });

  // 更新统计
  _dedupGroups = groups;  // 缓存供 AI 分析使用
  document.getElementById('dedupGroupCount').textContent = `疑似重复: ${groups.length}`;
  document.getElementById('dedupUnusedCount').textContent = `疑似废弃: ${unusedRoutes.length}`;

  // 检查 DeepSeek 是否可用
  checkDedupAi();

  // 渲染结果
  let html = '';

  if (groups.length > 0) {
    html += '<h3 style="font-size:16px;font-weight:600;margin-bottom:16px">🔍 疑似重复接口</h3>';
    html += groups.map((g, gi) => {
      const badgeCls = g.type;
      const routesHtml = g.routes.map(r => {
        const fs = frontendStatusLabels[r.frontendStatus] || frontendStatusLabels.needs_review;
        const packCount = featurePacks ? featurePacks.filter(p => (p.routes || []).some(pr => (typeof pr === 'string' ? pr : `${pr.method}:${pr.path}`) === routeKey(r))).length : 0;
        return `
          <div class="dedup-route-row">
            <span class="method-badge ${r.method.toLowerCase()}">${r.method}</span>
            <code>${r.path}</code>
            <div class="route-meta">
              <span>${fs.icon} ${fs.label}</span>
              ${r.frontendUsage?.length ? `<span>📂 ${r.frontendUsage.length} 文件</span>` : ''}
              ${packCount > 0 ? `<span>📦 ${packCount} 功能包</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
      return `
        <div class="dedup-group" id="dedup-group-${gi}">
          <div class="dedup-group-header" onclick="this.parentElement.classList.toggle('open')">
            <div class="dedup-group-title">
              <span class="dedup-group-badge ${badgeCls}">${g.label}</span>
              <span>${g.routes.length} 个接口</span>
              ${g.routes[0]?.name ? `<span style="color:#6b7280;font-weight:400;font-size:12px">— ${g.routes.map(r => r.name).join(' / ')}</span>` : ''}
            </div>
            <span style="font-size:12px;color:#9ca3af">点击展开</span>
          </div>
          <div class="dedup-group-body">
            ${routesHtml}
            <div id="dedup-ai-${gi}" class="dedup-ai-suggestion" style="display:none"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  if (unusedRoutes.length > 0) {
    html += `<h3 style="font-size:16px;font-weight:600;margin:${groups.length ? '24px' : '0'} 0 16px">👻 疑似废弃接口</h3>`;
    html += '<div class="dedup-group">';
    html += `<div class="dedup-group-header" onclick="this.parentElement.classList.toggle('open')">
      <div class="dedup-group-title">
        <span class="dedup-group-badge unused">无前端调用 · 无功能包</span>
        <span>${unusedRoutes.length} 个接口</span>
      </div>
      <span style="font-size:12px;color:#9ca3af">点击展开</span>
    </div>`;
    html += '<div class="dedup-group-body">';
    html += unusedRoutes.map(r => `
      <div class="dedup-route-row">
        <span class="method-badge ${r.method.toLowerCase()}">${r.method}</span>
        <code>${r.path}</code>
        <span style="font-size:12px;color:#6b7280">${r.name || ''}</span>
        <div class="route-meta">
          <span>${MODULE_MAP[r.module]?.icon || '📦'} ${MODULE_MAP[r.module]?.name || r.module}</span>
        </div>
      </div>
    `).join('');
    html += '</div></div>';
  }

  if (groups.length === 0 && unusedRoutes.length === 0) {
    html = `
      <div style="text-align:center;padding:60px">
        <div style="font-size:48px;margin-bottom:12px">✅</div>
        <div style="font-size:18px;font-weight:600;color:#10b981;margin-bottom:8px">未发现重复或废弃接口</div>
        <div style="color:#9ca3af">当前 ${allRoutes.length} 个接口结构清晰</div>
      </div>
    `;
  }

  document.getElementById('dedupResults').innerHTML = html;
}

// DeepSeek AI 语义分析
let dedupAiAvailable = false;
let _dedupGroups = [];  // 缓存 runDedupAnalysis 的分组结果

async function checkDedupAi() {
  try {
    const res = await fetch('/api/deepseek-status', { credentials: 'include' });
    const data = await res.json();
    dedupAiAvailable = data.available;
    document.getElementById('dedupAiBtn').style.display = data.available ? '' : 'none';
  } catch {
    document.getElementById('dedupAiBtn').style.display = 'none';
  }
}

async function runDedupAI() {
  if (!allRoutes || !allRoutes.length) return;

  // 复用 runDedupAnalysis 缓存的分组，而不是重新收集
  const groups = _dedupGroups || [];
  if (groups.length === 0) {
    showToast('没有疑似重复接口，无需 AI 分析');
    return;
  }

  showToast('🤖 DeepSeek 分析中...');

  // 限制发送数量，避免 API 超时（最多前 30 组）
  const sendGroups = groups.slice(0, 30);

  // 发送到 DeepSeek
  try {
    const res = await fetch('/api/dedup-analyze', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: sendGroups.map(g => ({
        type: g.type,
        routes: g.routes.map(r => ({ method: r.method, path: r.path, name: r.name, module: r.module, description: r.customDescription || '' }))
      }))})
    });
    const data = await res.json();
    if (data.success && data.suggestions) {
      // 渲染 AI 建议到对应分组
      data.suggestions.forEach((suggestion, i) => {
        const el = document.getElementById(`dedup-ai-${i}`);
        if (el) {
          el.style.display = 'block';
          el.innerHTML = `<strong>🤖 DeepSeek 建议：</strong><br>${suggestion.replace(/\n/g, '<br>')}`;
        }
      });
      showToast(`✅ AI 分析完成（${sendGroups.length}/${groups.length} 组）`);
    } else {
      showToast('❌ ' + (data.message || 'AI 分析失败'));
    }
  } catch (e) {
    showToast('❌ AI 分析请求失败');
  }
}

// ===== 生命周期管理 =====
const LIFECYCLE_STATES = [
  { key: 'active', label: '✅ 正常使用', color: '#10b981', bg: '#d1fae5', text: '#065f46' },
  { key: 'planned', label: '📋 规划中', color: '#6366f1', bg: '#e0e7ff', text: '#3730a3' },
  { key: 'needs_review', label: '🔍 需要复查', color: '#f59e0b', bg: '#fef3c7', text: '#92400e' },
  { key: 'deprecated', label: '⚠️ 准备废弃', color: '#ef4444', bg: '#fee2e2', text: '#991b1b' },
  { key: 'removed', label: '🗑️ 已移除', color: '#9ca3af', bg: '#e5e7eb', text: '#374151' }
];

function getLifecycle(route) {
  return route.lifecycle || 'active';
}

function getLifecycleInfo(key) {
  return LIFECYCLE_STATES.find(s => s.key === key) || LIFECYCLE_STATES[0];
}

function renderLifecycle() {
  if (!allRoutes || !allRoutes.length) {
    document.getElementById('lifecycleGroups').innerHTML = '<div style="text-align:center;padding:60px;color:#9ca3af">暂无数据</div>';
    return;
  }

  // 统计
  const counts = {};
  LIFECYCLE_STATES.forEach(s => counts[s.key] = 0);
  allRoutes.forEach(r => {
    const lc = getLifecycle(r);
    counts[lc] = (counts[lc] || 0) + 1;
  });

  // 仪表盘
  document.getElementById('lifecycleDashboard').innerHTML = LIFECYCLE_STATES.map(s => `
    <div class="health-card" style="cursor:pointer" onclick="scrollToLifecycleGroup('${s.key}')">
      <div class="icon">${s.label.split(' ')[0]}</div>
      <div class="value" style="color:${s.color}">${counts[s.key]}</div>
      <div class="label">${s.label.split(' ').slice(1).join(' ')}</div>
    </div>
  `).join('');

  // 警告：deprecated 仍被前端调用
  const deprecatedWithFrontend = allRoutes.filter(r => getLifecycle(r) === 'deprecated' && r.frontendUsage?.length > 0);
  const warningsHtml = deprecatedWithFrontend.map(r => `
    <div class="lifecycle-warning">
      <span class="warn-icon">🚨</span>
      <div>
        <strong><code>${r.method} ${r.path}</code></strong> 已标记 deprecated，但仍被 ${r.frontendUsage.length} 个前端文件调用：
        <span style="font-family:monospace;font-size:12px">${r.frontendUsage.join(', ')}</span>
      </div>
    </div>
  `).join('');
  document.getElementById('lifecycleWarnings').innerHTML = warningsHtml;

  // 按状态分组
  const groups = {};
  LIFECYCLE_STATES.forEach(s => groups[s.key] = []);
  allRoutes.forEach(r => {
    const lc = getLifecycle(r);
    if (groups[lc]) groups[lc].push(r);
  });

  const html = LIFECYCLE_STATES.map(s => {
    const routes = groups[s.key];
    if (routes.length === 0) return '';
    const rowsHtml = routes.map(r => {
      const idx = allRoutes.indexOf(r);
      const fsLabel = r.frontendUsage?.length > 0 ? `📂 ${r.frontendUsage.length}` : '';
      return `
        <div class="lifecycle-row">
          <span class="method-badge ${r.method.toLowerCase()}">${r.method}</span>
          <code>${r.path}</code>
          <span style="font-size:11px;color:#6b7280">${r.name || ''}</span>
          ${fsLabel ? `<span style="font-size:11px;color:#3b82f6">${fsLabel}</span>` : ''}
          <select class="lifecycle-select" onchange="changeLifecycle(${idx}, this.value)">
            ${LIFECYCLE_STATES.map(ls => `<option value="${ls.key}" ${ls.key === s.key ? 'selected' : ''}>${ls.label}</option>`).join('')}
          </select>
        </div>
      `;
    }).join('');

    return `
      <div class="lifecycle-group" id="lifecycle-${s.key}">
        <div class="lifecycle-group-header" onclick="this.parentElement.classList.toggle('open')">
          <div class="lifecycle-group-title">
            <span>${s.label}</span>
            <span class="lifecycle-group-count" style="background:${s.bg};color:${s.text}">${routes.length}</span>
          </div>
          <span style="font-size:12px;color:#9ca3af">点击展开</span>
        </div>
        <div class="lifecycle-group-body">${rowsHtml}</div>
      </div>
    `;
  }).join('');

  document.getElementById('lifecycleGroups').innerHTML = html || '<div style="text-align:center;padding:40px;color:#9ca3af">暂无接口</div>';
}

async function changeLifecycle(idx, newState) {
  const route = allRoutes[idx];
  if (!route) return;
  const routeId = route.route_id || `${route.method}:${route.path}`;

  // deprecated → 不能生成 Claude 任务的警告
  if (newState === 'deprecated' && route.frontendUsage?.length > 0) {
    if (!confirm(`⚠️ ${route.method} ${route.path} 仍被 ${route.frontendUsage.length} 个前端文件调用，确定标记为 deprecated？`)) {
      renderLifecycle();
      return;
    }
  }

  try {
    const res = await fetch(`/api/registry/${encodeURIComponent(routeId)}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lifecycle: newState })
    });
    const data = await res.json();
    if (data.success) {
      route.lifecycle = newState;
      showToast(`✅ ${route.method} ${route.path} → ${getLifecycleInfo(newState).label}`);
      renderLifecycle();
    } else {
      showToast('❌ ' + (data.message || '更新失败'));
    }
  } catch (e) {
    showToast('❌ 网络错误');
  }
}

function scrollToLifecycleGroup(key) {
  const el = document.getElementById(`lifecycle-${key}`);
  if (el) {
    el.classList.add('open');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ===== 规则引擎：生命周期约束 =====

// 检查接口是否可以生成 Claude 任务
function canGenerateTask(route) {
  const lc = getLifecycle(route);
  if (lc === 'deprecated') return { ok: false, reason: '⚠️ 接口已标记为 deprecated，不能生成前端任务' };
  if (lc === 'removed') return { ok: false, reason: '🗑️ 接口已标记为 removed，不能生成前端任务' };
  return { ok: true };
}

// ===== 发布前检查 =====
function generatePrereleaseCheck() {
  const routes = allRoutes || [];
  const tr = testRecords || {};
  const now = new Date().toLocaleString('zh-CN');

  // 1. 高风险接口
  const highRisk = routes.filter(r => r.riskLevel === 'high');
  // 2. 未测试接口
  const untested = routes.filter(r => {
    const rec = tr[r.route_id];
    return !rec || !rec.lastTest || rec.lastTest.conclusion === 'pending';
  });
  // 3. 待审核接口 (frontendStatus = needs_review)
  const needsReview = routes.filter(r => r.frontendStatus === 'needs_review');
  // 4. 前台应接但未接 (非admin路径，frontendStatus=planned/needs_review，无frontendUsage)
  const frontendMissing = routes.filter(r => {
    if (r.path.startsWith('/api/admin/') || r.frontendStatus === 'admin_only' || r.frontendStatus === 'internal' || r.frontendStatus === 'deprecated') return false;
    return r.frontendStatus === 'planned' || r.frontendStatus === 'needs_review';
  });
  // 5. 后台应接但未接 (admin路径，frontendStatus=planned/needs_review)
  const adminMissing = routes.filter(r => {
    if (!r.path.startsWith('/api/admin/') && r.frontendStatus !== 'admin_only') return false;
    return r.frontendStatus === 'planned' || r.frontendStatus === 'needs_review';
  });
  // 6. deprecated 但仍被调用
  const deprecatedButUsed = routes.filter(r => {
    return (r.frontendStatus === 'deprecated' || r.lifecycle === 'deprecated') && r.frontendUsage && r.frontendUsage.length > 0;
  });
  // 7. admin 接口是否都要求管理员
  const adminNoAuth = routes.filter(r => {
    return r.path.startsWith('/api/admin/') && r.authType !== 'admin';
  });

  // 按严重程度排序：高风险 > 未测试 > deprecated仍被调用 > admin权限异常 > 待审核 > 前台缺失 > 后台缺失
  const checks = [
    { key: 'highRisk', emoji: '🔴', title: '高风险接口', items: highRisk, severity: 3 },
    { key: 'untested', emoji: '❓', title: '未测试接口', items: untested, severity: 3 },
    { key: 'deprecatedButUsed', emoji: '⚠️', title: 'deprecated 但仍被调用', items: deprecatedButUsed, severity: 3 },
    { key: 'adminNoAuth', emoji: '🚨', title: 'admin 接口未要求管理员权限', items: adminNoAuth, severity: 3 },
    { key: 'needsReview', emoji: '🔍', title: '待审核接口', items: needsReview, severity: 2 },
    { key: 'frontendMissing', emoji: '📱', title: '前台应接但未接', items: frontendMissing, severity: 1 },
    { key: 'adminMissing', emoji: '🔧', title: '后台应接但未接', items: adminMissing, severity: 1 },
  ];

  // 计算总问题数
  const totalIssues = checks.reduce((s, c) => s + c.items.length, 0);
  const criticalCount = checks.filter(c => c.severity === 3).reduce((s, c) => s + c.items.length, 0);

  // 总体状态
  const overallStatus = criticalCount > 0 ? '❌ 发现关键问题，建议修复后再发布'
    : totalIssues > 0 ? '⚠️ 有非关键问题，可评估后发布'
    : '✅ 检查通过，可以发布';

  const overallColor = criticalCount > 0 ? '#ef4444' : totalIssues > 0 ? '#f59e0b' : '#10b981';

  let html = `<div class="prerelease-report">`;

  // 总览卡片
  html += `
    <div style="background:white;border-radius:12px;border:1px solid #e5e7eb;padding:24px;margin-bottom:20px;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">${criticalCount > 0 ? '❌' : totalIssues > 0 ? '⚠️' : '✅'}</div>
      <div style="font-size:20px;font-weight:700;color:${overallColor};margin-bottom:8px">${overallStatus}</div>
      <div style="font-size:13px;color:#6b7280">检查时间：${now} · 共 ${routes.length} 个接口 · 发现 ${totalIssues} 个问题</div>
      <div style="display:flex;gap:16px;justify-content:center;margin-top:16px;flex-wrap:wrap">
        ${checks.filter(c => c.items.length > 0).map(c => `
          <div style="padding:8px 16px;background:${c.severity === 3 ? '#fef2f2' : c.severity === 2 ? '#fffbeb' : '#f0fdf4'};border-radius:8px;border:1px solid ${c.severity === 3 ? '#fecaca' : c.severity === 2 ? '#fde68a' : '#bbf7d0'}">
            <div style="font-size:20px;font-weight:700;color:${c.severity === 3 ? '#ef4444' : c.severity === 2 ? '#f59e0b' : '#10b981'}">${c.items.length}</div>
            <div style="font-size:11px;color:#6b7280;margin-top:2px">${c.emoji} ${c.title}</div>
          </div>
        `).join('')}
      </div>
    </div>`;

  // 逐项展开
  checks.forEach(c => {
    if (c.items.length === 0) return;
    const borderColor = c.severity === 3 ? '#fecaca' : c.severity === 2 ? '#fde68a' : '#bbf7d0';
    const bgColor = c.severity === 3 ? '#fef2f2' : c.severity === 2 ? '#fffbeb' : '#f0fdf4';
    const badgeColor = c.severity === 3 ? '#ef4444' : c.severity === 2 ? '#f59e0b' : '#10b981';

    html += `
      <div style="background:white;border-radius:12px;border:1px solid ${borderColor};margin-bottom:16px;overflow:hidden">
        <div style="padding:14px 20px;background:${bgColor};display:flex;justify-content:space-between;align-items:center">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:18px">${c.emoji}</span>
            <span style="font-size:14px;font-weight:600;color:#1f2937">${c.title}</span>
            <span style="background:${badgeColor};color:white;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600">${c.items.length}</span>
          </div>
          <span style="font-size:11px;color:#6b7280">${c.severity === 3 ? '🔴 关键' : c.severity === 2 ? '🟡 重要' : '🟢 建议'}</span>
        </div>
        <div style="padding:12px 20px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="border-bottom:1px solid #f3f4f6">
                <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:500">方法</th>
                <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:500">路径</th>
                <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:500">名称</th>
                <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:500">模块</th>
                <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:500">风险</th>
                <th style="text-align:left;padding:6px 8px;color:#6b7280;font-weight:500">前端状态</th>
              </tr>
            </thead>
            <tbody>
              ${c.items.slice(0, 50).map(r => `
                <tr style="border-bottom:1px solid #f9fafb">
                  <td style="padding:6px 8px"><span style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${r.method}</span></td>
                  <td style="padding:6px 8px;font-family:monospace;font-size:12px;color:#3b82f6">${r.path}</td>
                  <td style="padding:6px 8px">${r.name || '-'}</td>
                  <td style="padding:6px 8px">${(MODULE_MAP[r.module] || {}).icon || '📦'} ${r.module || '-'}</td>
                  <td style="padding:6px 8px">${riskLabels[r.riskLevel] || r.riskLevel}</td>
                  <td style="padding:6px 8px">${(frontendStatusLabels[r.frontendStatus] || {}).icon || ''} ${(frontendStatusLabels[r.frontendStatus] || {}).label || r.frontendStatus || '-'}</td>
                </tr>
              `).join('')}
              ${c.items.length > 50 ? `<tr><td colspan="6" style="padding:8px;text-align:center;color:#6b7280;font-size:12px">... 还有 ${c.items.length - 50} 个</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>`;
  });

  // 全部通过时
  if (totalIssues === 0) {
    html += `
      <div style="text-align:center;padding:40px;color:#10b981">
        <div style="font-size:64px;margin-bottom:16px">🎉</div>
        <div style="font-size:18px;font-weight:600">所有检查项全部通过！</div>
        <div style="font-size:13px;color:#6b7280;margin-top:8px">共 ${routes.length} 个接口，无任何问题</div>
      </div>`;
  }

  html += `</div>`;
  document.getElementById('prereleaseContent').innerHTML = html;

  // 缓存用于导出
  window._prereleaseChecks = { checks, totalIssues, criticalCount, overallStatus, now, routeCount: routes.length };
}

function exportPrereleaseMarkdown() {
  if (!window._prereleaseChecks) {
    showToast('请先点击「一键生成检查」');
    return;
  }
  const { checks, totalIssues, criticalCount, overallStatus, now, routeCount } = window._prereleaseChecks;

  let md = `# 🚀 发布前检查报告\n\n`;
  md += `- 检查时间：${now}\n`;
  md += `- 接口总数：${routeCount}\n`;
  md += `- 问题总数：${totalIssues}\n`;
  md += `- 总结论：${overallStatus}\n\n`;
  md += `---\n\n`;

  checks.forEach(c => {
    if (c.items.length === 0) return;
    md += `## ${c.emoji} ${c.title}（${c.items.length} 个）\n\n`;
    md += `| 方法 | 路径 | 名称 | 模块 | 风险 | 前端状态 |\n`;
    md += `|------|------|------|------|------|----------|\n`;
    c.items.forEach(r => {
      const riskText = { low: '低', medium: '中', high: '高' }[r.riskLevel] || r.riskLevel;
      const fsText = (frontendStatusLabels[r.frontendStatus] || {}).label || r.frontendStatus || '-';
      md += `| ${r.method} | \`${r.path}\` | ${r.name || '-'} | ${r.module || '-'} | ${riskText} | ${fsText} |\n`;
    });
    md += `\n`;
  });

  if (totalIssues === 0) {
    md += `> ✅ 所有检查项全部通过！\n`;
  }

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `prerelease-check-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ Markdown 已下载');
}
