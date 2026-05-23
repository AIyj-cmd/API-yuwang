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
    hasAudit: allRoutes.filter(r => r.hasAuditLog).length
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
        <div class="api-name">${route.name} ${changeBadge}</div>
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
    <div style="margin-top:20px;display:flex;gap:12px">
      <button class="btn btn-primary" onclick="closeModal()">关闭</button>
      <button class="btn btn-secondary" onclick="toggleTestPanel(${index})">🧪 测试接口</button>
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
  `;

  document.getElementById('detailModal').style.display = 'flex';
}

function renderDetailField(label, value) {
  return `<div class="detail-row"><label>${label}</label><div class="value">${value}</div></div>`;
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
