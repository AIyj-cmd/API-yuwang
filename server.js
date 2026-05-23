import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { MODULE_DEFINITIONS, getModule, getAutoDescription } from './modules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  });
}

const PORT = Number(process.env.API_MANAGER_PORT || 3003);
const API_REGISTRY_PATH = join(__dirname, 'api-registry-analyzed.json');
const YUWANG_SERVER_DIR = process.env.YUWANG_SERVER_DIR || '/root/yuwang/server';
const YUWANG_REGISTRY_PATH = join(YUWANG_SERVER_DIR, 'api-registry.json');
const YUWANG_BASE_URL = process.env.YUWANG_BASE_URL || 'http://localhost:3001';
const API_MANAGER_SESSION_SECRET = process.env.API_MANAGER_SESSION_SECRET || '';

const CLAUDE_TASK_DRAFTS_PATH = join(__dirname, 'claude-task-drafts.json');
const API_MANAGER_ENABLE_AI_TASKS = process.env.API_MANAGER_ENABLE_AI_TASKS === 'true';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
const ADMIN_USERNAME = process.env.API_MANAGER_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.API_MANAGER_ADMIN_PASSWORD || '';
const sessions = new Map();
const loginAttempts = new Map();

function buildRouteId(method, path) { return `${method.toUpperCase()}:${path}`; }
function classifyDetectedAuth(method, path) {
  if (path === '/api/auth/login' || path === '/api/auth/register') return 'anonymous';
  if (path === '/api/auth/me') return 'user';
  if (path.startsWith('/api/admin/')) return 'admin';
  if (path === '/api/health') return 'anonymous';
  if (method === 'GET') return 'anonymous';
  return 'user';
}
function classifyDetectedRisk(method, path) {
  if (path === '/api/health') return 'low';
  if (method === 'DELETE') return 'high';
  if (['PATCH', 'PUT'].includes(method)) return 'medium';
  if (method === 'POST') return path.startsWith('/api/admin/') ? 'high' : 'medium';
  return 'low';
}
function toGovernance(route) {
  const method = route.method.toUpperCase();
  const path = route.path;
  const detectedAuth = classifyDetectedAuth(method, path);
  const detectedRisk = classifyDetectedRisk(method, path);

  // 特殊路径强制覆盖，不信任旧值
  const FORCED_OVERRIDES = {
    '/api/auth/login':    { auth: 'anonymous', risk: 'medium' },
    '/api/auth/register': { auth: 'anonymous', risk: 'medium' },
    '/api/auth/logout':   { auth: 'anonymous', risk: 'low' },
    '/api/health':        { auth: 'anonymous', risk: 'low' },
  };
  const forced = FORCED_OVERRIDES[path];
  const finalAuth = forced ? forced.auth : (route.accessOverride || detectedAuth);
  const finalRisk = forced ? forced.risk : (route.riskOverride || detectedRisk);

  // apiType 映射：前端 typeLabels 只认 public / authenticated / admin
  const apiTypeMap = { admin: 'admin', user: 'authenticated', anonymous: 'public' };
  const apiType = apiTypeMap[finalAuth] || 'public';

  return {
    route_id: buildRouteId(method, path),
    method,
    path,
    name: route.name || '',
    file: route.file || '',
    line: route.line || 0,
    module: route.module || getModule(path),
    autoDescription: route.autoDescription || getAutoDescription(method, path),
    // 旧字段（前端使用），统一走映射
    apiType,
    authType: finalAuth,
    riskLevel: finalRisk,
    status: route.status || 'implemented',
    // 新字段
    detectedAuth,
    detectedRisk,
    dbTables: route.dbTables || [],
    hasAuditLog: route.hasAuditLog || false,
    description: route.description || '',
    customDescription: route.customDescription ?? route.description ?? '',
    tags: route.tags || [],
    frontendStatus: route.frontendStatus || route.frontend_status || (path.startsWith('/api/admin/') ? 'admin_only' : path === '/api/health' ? 'internal' : 'needs_review'),
    accessOverride: route.accessOverride || null,
    riskOverride: route.riskOverride || null,
    reviewNote: route.reviewNote || '',
    deprecatedReason: route.deprecatedReason || '',
    favorite: Boolean(route.favorite),
    frontendUsage: route.frontendUsage || [],
  };
}

// 密码哈希比较
function verifyPassword(input, hashed) {
  return crypto.createHash('sha256').update(input).digest('hex') === hashed;
}

function isAdmin(req) {
  const cookie = req.headers.cookie || '';
  const kv = Object.fromEntries(cookie.split(';').map(c => c.trim()).filter(Boolean).map(c => c.split('=')));
  const token = kv.api_manager_session;
  if (!token || !sessions.has(token)) return false;
  const sess = sessions.get(token);
  if (Date.now() - sess.createdAt > 28800000) { sessions.delete(token); return false; }
  return true;
}
function requireAdmin(req, res) {
  if (!isAdmin(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Admin auth required' }));
    return false;
  }
  return true;
}
function loadApiRegistry() { try { return JSON.parse(readFileSync(API_REGISTRY_PATH, 'utf-8')); } catch { return []; } }
function saveApiRegistry(routes) {
  writeFileSync(API_REGISTRY_PATH, JSON.stringify(routes, null, 2), 'utf-8');
  if (process.env.API_MANAGER_WRITE_BACK_TO_YUWANG === 'true' && existsSync(YUWANG_SERVER_DIR)) {
    writeFileSync(YUWANG_REGISTRY_PATH, JSON.stringify(routes, null, 2), 'utf-8');
  }
}
async function parseBody(req) { return new Promise(resolve => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{resolve(JSON.parse(b||'{}'));}catch{resolve({});}});}); }

function loadClaudeTaskDrafts() { try { return JSON.parse(readFileSync(CLAUDE_TASK_DRAFTS_PATH, 'utf-8')); } catch { return []; } }
function saveClaudeTaskDrafts(drafts) { writeFileSync(CLAUDE_TASK_DRAFTS_PATH, JSON.stringify(drafts, null, 2), 'utf-8'); }
function buildContextFromRoutes(routes, body = {}) {
  const allowUnreviewed = Boolean(body.allowUnreviewed);
  const targetClient = body.targetClient === 'admin' ? 'admin' : 'user';
  for (const r of routes) {
    if (r.frontendStatus === 'deprecated') throw new Error(`接口 ${r.route_id} 已废弃，禁止生成任务`);
    if (!allowUnreviewed && (r.frontendStatus === 'needs_review' || r.frontendStatus === 'internal')) throw new Error(`接口 ${r.route_id} 当前状态不允许生成任务`);
    if ((r.frontendStatus === 'admin_only' || r.path.startsWith('/api/admin/')) && targetClient !== 'admin') throw new Error(`接口 ${r.route_id} 仅支持管理后台`);
  }
  const featureName = body.featureName || '前端任务接入';
  const constraints = [
    '你只负责前端页面、交互和视觉实现，不要修改后端接口、数据库结构或后端业务逻辑。',
    '不允许新增后端接口，不允许新增 mock 接口，不允许编造不存在的接口。',
    '必须处理 loading / empty / error / unauthorized 状态。'
  ];
  if (targetClient === 'admin') constraints.push('仅可在 /admin 相关页面实现，不要暴露到普通用户页面。');
  else constraints.push('只允许普通用户页面调用，禁止调用 /api/admin/**。');
  return {
    featureName,
    targetClient,
    routes: routes.map(r => ({ routeId: r.route_id, method: r.method, path: r.path, authType: r.authType, apiType: r.apiType, riskLevel: r.riskLevel, frontendStatus: r.frontendStatus, customDescription: r.customDescription || '', autoDescription: r.autoDescription || '', relatedTables: r.dbTables || [], frontendUsage: r.frontendUsage || [] })),
    constraints,
    acceptanceCriteria: ['页面能正常调用列出的接口','接口失败时页面不崩溃','空数据时有清晰提示','未登录或权限不足时有合理提示','不出现 mock 数据冒充真实数据','不修改后端代码','不新增未约定接口','页面交互完成后数据状态能正确刷新'],
    antiPatterns: ['不要改后端','不要新增接口','不要把 admin 接口接到普通用户页面','不要绕过登录状态','不要写死假数据','不要为了页面好看改变业务语义','不要删除已有功能','不要大范围重构无关页面']
  };
}
function buildTemplatePrompt(context) {
  const targetLabel = context.targetClient === 'admin' ? '管理后台' : '用户前台';
  const routesText = context.routes.map((r, i) => `${i + 1}. ${r.method} ${r.path}
   - 权限：${r.authType}
   - 风险：${r.riskLevel}
   - 前端状态：${r.frontendStatus}
   - 用途：${r.customDescription || r.autoDescription || '待补充'}`).join('\n\n');
  return `你只负责前端页面、交互和视觉实现，不要修改后端接口、数据库结构或后端业务逻辑。

项目：yuwang

目标：
为【${context.featureName}】接入前端页面和交互。

目标端：
${targetLabel}

可用接口：
${routesText}

前端要求：
1. 使用现有项目的前端技术栈和现有 API 调用方式。
2. 不要新增后端接口。
3. 不要修改接口路径、请求方法或参数语义。
4. 不要使用假数据替代真实接口。
5. 需要处理 loading 状态。
6. 需要处理空状态。
7. 需要处理接口错误状态。
8. 需要处理未登录或权限不足状态。
9. 保持当前项目视觉风格，具体页面设计可以自由发挥。
10. 如果是管理后台功能，只能放在 /admin 相关页面，不要暴露到普通用户页面。
11. 如果是普通用户功能，不要调用 /api/admin/** 接口。

验收标准：
${context.acceptanceCriteria.map((x,i)=>`${i+1}. ${x}`).join('\n')}

反模式：
${context.antiPatterns.map((x,i)=>`${i+1}. ${x}`).join('\n')}`;
}

async function proxyRequest(method, path, headers, body) {
  const url = `${YUWANG_BASE_URL}${path}`;
  const options = { method, headers: { 'Content-Type': 'application/json', ...headers } };
  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) options.body = typeof body === 'string' ? body : JSON.stringify(body);
  try { const start = Date.now(); const res = await fetch(url, options); const ct = res.headers.get('content-type')||''; const rb = ct.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, statusText: res.statusText, headers: Object.fromEntries(res.headers.entries()), body: rb, time: Date.now()-start };
  } catch (err) { return { status: 0, statusText: 'Error', headers: {}, body: { error: err.message }, time: 0 }; }
}

function scanApisFromCode() {
  const serverDir = YUWANG_SERVER_DIR;
  if (!existsSync(serverDir)) return [];
  const files = readdirSync(serverDir).filter(f => f.endsWith('.ts'));
  const routes = [];
  const routeRegex = /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
  for (const file of files) {
    const filePath = join(serverDir, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let match;
      routeRegex.lastIndex = 0;
      while ((match = routeRegex.exec(lines[i])) !== null) {
        const method = match[1].toUpperCase();
        const path = match[2];
        if (path.startsWith('/api/')) {
          routes.push({ method, path, file, line: i + 1 });
        }
      }
    }
  }
  return routes;
}
function syncRegistry() { /* deprecated, kept for compat */ return false; }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`); const path = url.pathname; const method = req.method;
  const origin = req.headers.origin || '';
  const allowed = process.env.API_MANAGER_ALLOWED_ORIGIN || '';
  if (!allowed || allowed.split(',').some(o => o.trim() === origin)) {
    res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (path === '/api/manager/auth/login' && method === 'POST') {
    if (!API_MANAGER_SESSION_SECRET || !ADMIN_PASSWORD) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,message:'Missing auth env config'})); return; }
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || [];
    const recent = attempts.filter(t => now - t < 300000);
    if (recent.length >= 5) { res.writeHead(429, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,message:'Too many attempts, try again later'})); return; }
    const body = await parseBody(req);
    if (body.username === ADMIN_USERNAME && verifyPassword(body.password, ADMIN_PASSWORD)) {
      loginAttempts.delete(ip);
      const token = crypto.createHmac('sha256', API_MANAGER_SESSION_SECRET).update(`${Date.now()}-${Math.random()}`).digest('hex');
      sessions.set(token, { createdAt: Date.now() });
      res.setHeader('Set-Cookie', `api_manager_session=${token}; HttpOnly; Path=/; Max-Age=28800; SameSite=Lax`);
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:true})); return;
    }
    recent.push(now); loginAttempts.set(ip, recent);
    res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,message:'invalid credentials'})); return;
  }
  if (path === '/api/manager/auth/logout' && method === 'POST') {
    const cookie = req.headers.cookie || ''; const kv = Object.fromEntries(cookie.split(';').map(c => c.trim()).filter(Boolean).map(c => c.split('=')));
    if (kv.api_manager_session) sessions.delete(kv.api_manager_session);
    res.setHeader('Set-Cookie', 'api_manager_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
    res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:true})); return;
  }

  if (path.startsWith('/api/') && !path.startsWith('/api/manager/auth/') && !requireAdmin(req, res)) return;

  if (path === '/api/registry' && method === 'GET') {
    const routes = loadApiRegistry();
    const routesWithId = routes.map(r => ({
      ...r,
      route_id: r.route_id || buildRouteId(r.method, r.path)
    }));
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(routesWithId));
    return;
  }
  if (path === '/api/proxy' && method === 'POST') {
    const body = await parseBody(req); const { targetMethod, targetPath, headers, requestBody, dryRun=false } = body;
    const routes = loadApiRegistry().map(r => ({ ...r, route_id: r.route_id || buildRouteId(r.method, r.path) })); const route = routes.find(r => r.route_id === buildRouteId(targetMethod, targetPath));
    if (!route) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,message:'route not found in registry'})); return; }
    const m = targetMethod.toUpperCase();
    const risk = route.riskOverride || route.detectedRisk || route.riskLevel;
    const auth = route.accessOverride || route.detectedAuth || route.authType;
    if (m === 'DELETE') { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,message:'DELETE real execution is blocked'})); return; }
    // dryRun=true 一律模拟，不真实请求
    if (dryRun) {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({
        success: true,
        dryRun: true,
        message: `[DRY RUN] ${m} ${targetPath} - 请求已模拟，未真实执行`,
        route_id: route.route_id,
        risk,
        auth,
        simulatedResponse: { status: 200, message: '模拟响应' }
      }));
      return;
    }
    // 高风险/admin 且没传 dryRun → 拒绝真实执行
    if ((['POST','PATCH','PUT'].includes(m) && risk === 'high') || auth === 'admin') {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({success:true, blocked:true, message:'High-risk/admin API requires dryRun:true', route_id: route.route_id}));
      return;
    }
    const result = await proxyRequest(m, targetPath, headers, requestBody); res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(result)); return;
  }
  if (path.match(/^\/api\/registry\//) && ['PATCH','DELETE'].includes(method)) {
    const routeId = decodeURIComponent(path.split('/').pop()); let routes = loadApiRegistry(); const idx = routes.findIndex(r => (r.route_id || buildRouteId(r.method, r.path)) === routeId);
    if (idx < 0) { res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({message:'API不存在'})); return; }
    if (method === 'DELETE') { const removed=routes.splice(idx,1)[0]; saveApiRegistry(routes); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:true,removed})); return; }
    const body = await parseBody(req); const allow = ['customDescription','tags','module','favorite','frontendStatus','accessOverride','riskOverride','reviewNote','deprecatedReason'];
    allow.forEach(k=>{ if (body[k] !== undefined) routes[idx][k]=body[k];}); saveApiRegistry(routes); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:true,route:routes[idx]})); return;
  }
  if (path === '/api/scan' && method === 'GET') {
    const scanned = scanApisFromCode();
    const existing = new Set(loadApiRegistry().map(r => buildRouteId(r.method, r.path)));
    const newRoutes = scanned.filter(r => !existing.has(buildRouteId(r.method, r.path)));
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ success: true, scanned: scanned.length, newCount: newRoutes.length, newRoutes, all: scanned }));
    return;
  }
  if (path === '/api/sync' && method === 'POST') {
    // 扫描 yuwang 源码 → governance → 合并旧人工字段 → 写入 api-registry-analyzed.json
    const scanned = scanApisFromCode();
    const oldRoutes = loadApiRegistry();
    const oldMap = new Map(oldRoutes.map(r => [r.route_id || buildRouteId(r.method, r.path), r]));
    const KEEP_FIELDS = ['customDescription','tags','module','favorite','frontendStatus','accessOverride','riskOverride','reviewNote','deprecatedReason','description','dbTables','hasAuditLog','frontendUsage'];
    const merged = scanned.map(raw => {
      const gov = toGovernance(raw);
      const old = oldMap.get(gov.route_id);
      if (old) { KEEP_FIELDS.forEach(k => { if (old[k] !== undefined && old[k] !== null) gov[k] = old[k]; }); }
      return gov;
    });
    saveApiRegistry(merged);
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ success: true, count: merged.length, scanned: scanned.length, preserved: oldMap.size }));
    return;
  }
  if (path === '/api/sync-changes' && method === 'POST') {
    const body = await parseBody(req); let routes = loadApiRegistry(); const existing = new Map(routes.map(r=>[r.route_id,r]));
    for (const raw of (body.added||[])) {
      const gov = toGovernance(raw); const old = existing.get(gov.route_id); routes.push(old ? { ...gov, ...{
        customDescription: old.customDescription, tags: old.tags, frontendStatus: old.frontendStatus, accessOverride: old.accessOverride, riskOverride: old.riskOverride, reviewNote: old.reviewNote, deprecatedReason: old.deprecatedReason, favorite: old.favorite
      }} : gov);
    }
    if (body.removed?.length) { const rm = new Set(body.removed.map(r => buildRouteId(r.method, r.path))); routes = routes.filter(r => !rm.has(r.route_id)); }
    saveApiRegistry(routes); res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:true,count:routes.length})); return;
  }


  if (path === '/api/manager/config' && method === 'GET') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({ success: true, aiTasksEnabled: API_MANAGER_ENABLE_AI_TASKS && Boolean(DEEPSEEK_API_KEY) }));
    return;
  }
  if (path === '/api/claude-tasks/context' && method === 'POST') {
    const body = await parseBody(req);
    const routeIds = body.routeIds || [];
    const registry = loadApiRegistry().map(r => ({ ...r, route_id: r.route_id || buildRouteId(r.method, r.path) }));
    const routes = routeIds.map(id => registry.find(r => r.route_id === id));
    if (routes.some(r => !r)) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:false, message:'存在无效 routeId' })); return; }
    try { const context = buildContextFromRoutes(routes, body); res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:true, context })); } catch (e) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:false, message:e.message })); }
    return;
  }
  if (path === '/api/claude-tasks/generate-template' && method === 'POST') {
    const body = await parseBody(req);
    const registry = loadApiRegistry().map(r => ({ ...r, route_id: r.route_id || buildRouteId(r.method, r.path) }));
    const routes = (body.routeIds || []).map(id => registry.find(r => r.route_id === id));
    if (!routes.length || routes.some(r => !r)) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:false, message:'routeIds 无效' })); return; }
    try { const context = buildContextFromRoutes(routes, body); const generatedPrompt = buildTemplatePrompt(context); const now = new Date().toISOString();
      const routeIds = routes.map(r=>r.route_id).sort();
      const id = `task_${Date.now()}`;
      const draft = { id, title: context.featureName, moduleKey: routes[0].module || 'other', targetClient: context.targetClient, routeIds, source:'template', modelName:null, structuredContext:context, generatedPrompt, status:'draft', createdAt:now, updatedAt:now };
      const drafts = loadClaudeTaskDrafts(); drafts.push(draft); saveClaudeTaskDrafts(drafts);
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:true, draft }));
    } catch (e) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:false, message:e.message })); }
    return;
  }
  if (path === '/api/claude-tasks/generate-ai' && method === 'POST') {
    if (!(API_MANAGER_ENABLE_AI_TASKS && DEEPSEEK_API_KEY)) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:false, message:'AI 功能未启用' })); return; }
    const body = await parseBody(req);
    const registry = loadApiRegistry().map(r => ({ ...r, route_id: r.route_id || buildRouteId(r.method, r.path) }));
    const routes = (body.routeIds || []).map(id => registry.find(r => r.route_id === id));
    if (!routes.length || routes.some(r => !r)) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:false, message:'routeIds 无效' })); return; }
    try { const context = buildContextFromRoutes(routes, body);
      const systemPrompt = '你是一个前端任务说明生成器。你只负责把结构化 API 信息改写成 Claude Code 可以执行的前端任务。你不能编造不存在的接口。你不能要求修改后端。你不能要求新增数据库字段。你不能要求新增后端接口。你不能隐藏权限风险。你必须明确区分用户前台和管理后台。你必须输出中文。你只输出最终任务正文，不要输出解释。';
      const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${DEEPSEEK_API_KEY}`}, body: JSON.stringify({ model: DEEPSEEK_MODEL, messages:[{role:'system',content:systemPrompt},{role:'user',content:JSON.stringify(context)}], temperature:0.3 }) });
      if (!response.ok) { const t=await response.text(); throw new Error(`DeepSeek 调用失败: ${response.status} ${t}`); }
      const data = await response.json(); const generatedPrompt = data?.choices?.[0]?.message?.content?.trim(); if (!generatedPrompt) throw new Error('DeepSeek 未返回有效内容');
      const now = new Date().toISOString();
      const routeIds = routes.map(r=>r.route_id).sort();
      const id = `task_${Date.now()}`;
      const draft = { id, title: context.featureName, moduleKey: routes[0].module || 'other', targetClient: context.targetClient, routeIds, source:'deepseek', modelName:DEEPSEEK_MODEL, structuredContext:context, generatedPrompt, status:'draft', createdAt:now, updatedAt:now };
      const drafts = loadClaudeTaskDrafts(); drafts.push(draft); saveClaudeTaskDrafts(drafts);
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:true, draft }));
    } catch (e) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:false, message:e.message })); }
    return;
  }
  if (path === '/api/claude-tasks' && method === 'GET') { const drafts=loadClaudeTaskDrafts().sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)); res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ success:true, drafts })); return; }
  if (path.match(/^\/api\/claude-tasks\//) && method === 'PATCH') {
    const id = decodeURIComponent(path.split('/').pop());
    const body = await parseBody(req);
    const drafts = loadClaudeTaskDrafts();
    const idx = drafts.findIndex(d => d.id === id);
    const allowStatus = ['draft','accepted','copied','archived'];
    if (body.status && !allowStatus.includes(body.status)) { res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,message:'无效状态'}));return; }
    if (idx < 0) {
      // 新草稿 - upsert 创建
      const now = new Date().toISOString();
      const draft = { id, title: body.title || '未命名', generatedPrompt: body.generatedPrompt || '', routeIds: body.routeIds || [], source: body.source || 'manual', modelName: body.modelName || null, targetClient: body.targetClient || 'user', structuredContext: body.structuredContext || null, status: body.status || 'draft', createdAt: now, updatedAt: now };
      drafts.push(draft);
      saveClaudeTaskDrafts(drafts);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true,draft}));
    } else {
      ['title','generatedPrompt','status'].forEach(k => { if(body[k]!==undefined) drafts[idx][k]=body[k]; });
      drafts[idx].updatedAt = new Date().toISOString();
      saveClaudeTaskDrafts(drafts);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true,draft:drafts[idx]}));
    }
    return;
  }
  if (path.match(/^\/api\/claude-tasks\/[^/]+\/copied$/) && method === 'POST') { const parts=path.split('/'); const id=decodeURIComponent(parts[3]); const drafts=loadClaudeTaskDrafts(); const idx=drafts.findIndex(d=>d.id===id); if(idx<0){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,message:'草稿不存在'}));return;} drafts[idx].status='copied'; drafts[idx].updatedAt=new Date().toISOString(); saveClaudeTaskDrafts(drafts); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:true,draft:drafts[idx]})); return; }
  if (path.match(/^\/api\/claude-tasks\//) && method === 'DELETE') { const id = decodeURIComponent(path.split('/').pop()); let drafts=loadClaudeTaskDrafts(); const before=drafts.length; drafts=drafts.filter(d=>d.id!==id); if(before===drafts.length){res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,message:'草稿不存在'}));return;} saveClaudeTaskDrafts(drafts); res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true})); return; }

  // 模块管理
  const MODULES_JSON_PATH = join(__dirname, 'modules.json');
  function loadCustomModules() { try { return JSON.parse(readFileSync(MODULES_JSON_PATH, 'utf-8')); } catch { return {}; } }
  function saveCustomModules(mods) { writeFileSync(MODULES_JSON_PATH, JSON.stringify(mods, null, 2), 'utf-8'); }

  if (path === '/api/modules' && method === 'GET') {
    const merged = { ...MODULE_DEFINITIONS, ...loadCustomModules() };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(merged));
    return;
  }
  if (path === '/api/modules' && method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const body = await parseBody(req);
    const custom = loadCustomModules();
    Object.assign(custom, body);
    saveCustomModules(custom);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, modules: { ...MODULE_DEFINITIONS, ...custom } }));
    return;
  }

  // 静态文件服务
  const STATIC_FILES = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
  const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const staticFile = STATIC_FILES[path];
  if (staticFile && method === 'GET') {
    const filePath = join(__dirname, staticFile);
    if (existsSync(filePath)) {
      const ext = staticFile.slice(staticFile.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(readFileSync(filePath));
      return;
    }
  }

  res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({ message: 'Not Found' }));
});

server.listen(PORT, '0.0.0.0', () => { console.log(`🚀 API Manager 运行在 http://0.0.0.0:${PORT}`); });
