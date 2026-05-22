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
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await res.json();
    
    if (data.success) {
      hideLoginPage();
      loadData();
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
  document.getElementById('healthDashboard').innerHTML = `
    <div class="health-card info">
      <div class="icon">📊</div>
      <div class="value">${stats.total}</div>
      <div class="label">总接口数</div>
    </div>
    <div class="health-card danger">
      <div class="icon">🔴</div>
      <div class="value">${stats.highRisk}</div>
      <div class="label">高风险接口</div>
    </div>
    <div class="health-card warning">
      <div class="icon">⚠️</div>
      <div class="value">${stats.noFrontend}</div>
      <div class="label">未接入前端</div>
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

  const frontendHtml = route.frontendUsage.length > 0
    ? `<span class="frontend-info has">✅ ${route.frontendUsage[0]}</span>`
    : `<span class="frontend-info none">❌ 未接入</span>`;
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
function renderCoverage() {
  const section = document.getElementById('coverageSection');
  if (!section) return;

  const used = allRoutes.filter(r => r.frontendUsage.length > 0);
  const unused = allRoutes.filter(r => r.frontendUsage.length === 0);
  const pct = Math.round((used.length / allRoutes.length) * 100);

  // 按模块分组未使用的接口
  const byModule = {};
  unused.forEach(r => {
    const mod = r.module || 'other';
    if (!byModule[mod]) byModule[mod] = [];
    byModule[mod].push(r);
  });

  const moduleRows = Object.entries(byModule)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, routes]) => {
      const mod = MODULE_MAP[key] || MODULE_MAP['other'];
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f3f4f6">
        <span style="font-size:20px">${mod.icon}</span>
        <span style="flex:1;font-size:13px;font-weight:500">${mod.name}</span>
        <span style="font-size:13px;color:#ef4444;font-weight:600">${routes.length} 个未接入</span>
      </div>`;
    }).join('');

  section.innerHTML = `
    <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb">
      <h3 style="font-size:16px;font-weight:600;margin-bottom:16px">📊 前端覆盖率</h3>
      <div style="display:flex;gap:24px;align-items:center;margin-bottom:16px">
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:13px;color:#6b7280">已接入 ${used.length} / 总计 ${allRoutes.length}</span>
            <span style="font-size:14px;font-weight:600;color:${pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'}">${pct}%</span>
          </div>
          <div style="height:12px;background:#e5e7eb;border-radius:6px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'};border-radius:6px;transition:width 0.3s"></div>
          </div>
        </div>
        <div style="text-align:center">
          <div style="font-size:32px;font-weight:700;color:${pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'}">${pct}%</div>
          <div style="font-size:11px;color:#9ca3af">覆盖率</div>
        </div>
      </div>
      ${unused.length > 0 ? `
      <div style="margin-top:16px">
        <div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px">⚠️ 未接入前端的接口 (${unused.length})</div>
        <div style="max-height:200px;overflow-y:auto">${moduleRows}</div>
      </div>
      ` : '<div style="text-align:center;padding:20px;color:#10b981">✅ 所有接口已接入前端</div>'}
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
checkAuth().then(ok => { if (ok) loadData(); });
