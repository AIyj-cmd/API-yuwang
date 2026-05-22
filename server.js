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
const ADMIN_USERNAME = process.env.API_MANAGER_ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.API_MANAGER_ADMIN_PASSWORD || '';
const sessions = new Map();

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
  return Boolean(token && sessions.has(token));
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
  if (existsSync(YUWANG_SERVER_DIR)) writeFileSync(YUWANG_REGISTRY_PATH, JSON.stringify(routes, null, 2), 'utf-8');
}
async function parseBody(req) { return new Promise(resolve => { let b=''; req.on('data',c=>b+=c); req.on('end',()=>{ try{resolve(JSON.parse(b||'{}'));}catch{resolve({});}});}); }

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
function syncRegistry() { if (existsSync(YUWANG_REGISTRY_PATH)) { writeFileSync(join(__dirname,'api-registry.json'), readFileSync(YUWANG_REGISTRY_PATH,'utf-8')); return true; } return false; }

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`); const path = url.pathname; const method = req.method;
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (path === '/api/auth/login' && method === 'POST') {
    if (!API_MANAGER_SESSION_SECRET || !ADMIN_PASSWORD) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,message:'Missing auth env config'})); return; }
    const body = await parseBody(req);
    if (body.username === ADMIN_USERNAME && verifyPassword(body.password, ADMIN_PASSWORD)) {
      const token = crypto.createHmac('sha256', API_MANAGER_SESSION_SECRET).update(`${Date.now()}-${Math.random()}`).digest('hex');
      sessions.set(token, { createdAt: Date.now() });
      res.setHeader('Set-Cookie', `api_manager_session=${token}; HttpOnly; Path=/; Max-Age=28800; SameSite=Lax`);
      res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:true})); return;
    }
    res.writeHead(401, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,message:'invalid credentials'})); return;
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    const cookie = req.headers.cookie || ''; const kv = Object.fromEntries(cookie.split(';').map(c => c.trim()).filter(Boolean).map(c => c.split('=')));
    if (kv.api_manager_session) sessions.delete(kv.api_manager_session);
    res.setHeader('Set-Cookie', 'api_manager_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
    res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:true})); return;
  }

  if (path.startsWith('/api/') && !path.startsWith('/api/auth/') && !(path === '/api/modules' && method === 'GET') && !requireAdmin(req, res)) return;

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
    const routeId = decodeURIComponent(path.split('/').pop()); let routes = loadApiRegistry(); const idx = routes.findIndex(r => r.route_id === routeId);
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
    const synced = syncRegistry();
    const merged = loadApiRegistry().map(toGovernance); saveApiRegistry(merged);
    res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:true,count:merged.length,synced})); return;
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
