import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { MODULE_DEFINITIONS, getModule, getAutoDescription } from './modules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3003;
const API_REGISTRY_PATH = join(__dirname, 'api-registry-analyzed.json');
const YUWANG_REGISTRY_PATH = '/root/yuwang/server/api-registry.json';
const YUWANG_BASE_URL = 'http://localhost:3001';
const YUWANG_SERVER_DIR = '/root/yuwang/server';

// 扫描yuwang项目中的API
function scanApisFromCode() {
  const routes = [];
  
  // 扫描 routes.ts
  const routesContent = readFileSync(join(YUWANG_SERVER_DIR, 'routes.ts'), 'utf-8');
  const routeRegex = /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = routeRegex.exec(routesContent)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
      file: 'routes.ts',
      line: routesContent.substring(0, match.index).split('\n').length,
      isAdmin: false
    });
  }
  
  // 扫描 adminRoutes.ts
  const adminContent = readFileSync(join(YUWANG_SERVER_DIR, 'adminRoutes.ts'), 'utf-8');
  const adminRegex = /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  
  while ((match = adminRegex.exec(adminContent)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
      file: 'adminRoutes.ts',
      line: adminContent.substring(0, match.index).split('\n').length,
      isAdmin: true
    });
  }
  
  return routes;
}

// 从yuwang项目同步api-registry.json（仅在手动调用时）
function syncRegistry() {
  if (existsSync(YUWANG_REGISTRY_PATH)) {
    const content = readFileSync(YUWANG_REGISTRY_PATH, 'utf-8');
    writeFileSync(join(__dirname, 'api-registry.json'), content);
    console.log('✅ 已从 yuwang 同步 api-registry.json');
    return true;
  }
  return false;
}

// 加载API注册表
function loadApiRegistry() {
  try {
    const content = readFileSync(API_REGISTRY_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

// 保存API注册表
function saveApiRegistry(routes) {
  writeFileSync(API_REGISTRY_PATH, JSON.stringify(routes, null, 2), 'utf-8');
  // 同步回yuwang项目
  writeFileSync(YUWANG_REGISTRY_PATH, JSON.stringify(routes, null, 2), 'utf-8');
}

// 解析请求体
async function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
  });
}

// 代理请求到yuwang服务
async function proxyRequest(method, path, headers, body) {
  const url = `${YUWANG_BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  try {
    const startTime = Date.now();
    const res = await fetch(url, options);
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    let responseBody;
    const contentType = res.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      responseBody = await res.json();
    } else {
      responseBody = await res.text();
    }

    return {
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: responseBody,
      time: responseTime
    };
  } catch (err) {
    return {
      status: 0,
      statusText: 'Error',
      headers: {},
      body: { error: err.message },
      time: 0
    };
  }
}

// 创建HTTP服务器
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 静态文件
  const STATIC_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  if (path === '/' || path === '/index.html') {
    const html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // 其他静态文件
  const ext = '.' + path.split('.').pop();
  if (STATIC_TYPES[ext] && !path.includes('..')) {
    const filePath = join(__dirname, path);
    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': STATIC_TYPES[ext] });
      res.end(content);
      return;
    } catch (e) { /* 文件不存在，继续 */ }
  }

  // API 路由 - 获取注册表
  if (path === '/api/registry' && method === 'GET') {
    const routes = loadApiRegistry();
    
    // 直接返回数组格式（新格式）
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(routes));
    return;
  }

  // API 路由 - 获取模块定义（合并默认 + 自定义）
  if (path === '/api/modules' && method === 'GET') {
    const configPath = join(__dirname, 'modules-config.json');
    let custom = {};
    try { custom = JSON.parse(readFileSync(configPath, 'utf-8')).custom || {}; } catch {}
    const merged = { ...MODULE_DEFINITIONS };
    Object.entries(custom).forEach(([key, val]) => {
      merged[key] = { ...merged[key], ...val };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(merged));
    return;
  }

  // API 路由 - 更新自定义模块
  if (path === '/api/modules' && method === 'POST') {
    const body = await parseBody(req);
    const configPath = join(__dirname, 'modules-config.json');
    let config = { custom: {} };
    try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
    config.custom = { ...config.custom, ...body };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // API 路由 - 删除自定义模块
  if (path.startsWith('/api/modules/') && method === 'DELETE') {
    const key = path.split('/').pop();
    const configPath = join(__dirname, 'modules-config.json');
    let config = { custom: {} };
    try { config = JSON.parse(readFileSync(configPath, 'utf-8')); } catch {}
    delete config.custom[key];
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // API 路由 - 代理测试请求
  if (path === '/api/proxy' && method === 'POST') {
    const body = await parseBody(req);
    const { targetMethod, targetPath, headers, requestBody } = body;
    
    const result = await proxyRequest(targetMethod, targetPath, headers, requestBody);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // API 路由 - 变更检测
  if (path === '/api/scan-changes' && method === 'POST') {
    try {
      const codeRoutes = scanApisFromCode();
      const registryRoutes = loadApiRegistry();
      
      // 创建路径+方法的key用于对比
      const codeKeys = new Set(codeRoutes.map(r => `${r.method}:${r.path}`));
      const registryKeys = new Set(registryRoutes.map(r => `${r.method}:${r.path}`));
      
      // 找出新增的API
      const added = codeRoutes.filter(r => !registryKeys.has(`${r.method}:${r.path}`));
      
      // 找出删除的API
      const removed = registryRoutes.filter(r => !codeKeys.has(`${r.method}:${r.path}`));
      
      // 找出可能修改的API（路径相同但行号变化）
      const modified = [];
      registryRoutes.forEach(regRoute => {
        const codeRoute = codeRoutes.find(c => c.method === regRoute.method && c.path === regRoute.path);
        if (codeRoute && codeRoute.line !== regRoute.line) {
          modified.push({
            ...regRoute,
            oldLine: regRoute.line,
            newLine: codeRoute.line
          });
        }
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        added,
        removed,
        modified,
        summary: {
          codeCount: codeRoutes.length,
          registryCount: registryRoutes.length,
          addedCount: added.length,
          removedCount: removed.length,
          modifiedCount: modified.length
        }
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // API 路由 - 同步变更
  if (path === '/api/sync-changes' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const { added, removed } = body;
      
      let registryRoutes = loadApiRegistry();
      
      // 添加新增的API
      if (added && added.length > 0) {
        added.forEach(newRoute => {
          newRoute.module = getModule(newRoute.path);
          newRoute.autoDescription = getAutoDescription(newRoute.method, newRoute.path);
          newRoute.description = '';
          newRoute.tags = [];
          newRoute.favorite = false;
          registryRoutes.push(newRoute);
        });
      }
      
      // 删除已移除的API
      if (removed && removed.length > 0) {
        const removeKeys = new Set(removed.map(r => `${r.method}:${r.path}`));
        registryRoutes = registryRoutes.filter(r => !removeKeys.has(`${r.method}:${r.path}`));
      }
      
      saveApiRegistry(registryRoutes);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        count: registryRoutes.length,
        addedCount: added ? added.length : 0,
        removedCount: removed ? removed.length : 0
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // 更新API描述和标签
  if (path.match(/^\/api\/registry\/\d+$/) && method === 'PATCH') {
    const index = parseInt(path.split('/').pop());
    const routes = loadApiRegistry();
    
    if (index < 0 || index >= routes.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'API不存在' }));
      return;
    }

    const body = await parseBody(req);
    if (body.description !== undefined) routes[index].description = body.description;
    if (body.tags !== undefined) routes[index].tags = body.tags;
    if (body.module !== undefined) routes[index].module = body.module;
    if (body.favorite !== undefined) routes[index].favorite = body.favorite;

    saveApiRegistry(routes);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, route: routes[index] }));
    return;
  }

  // 删除API记录
  if (path.match(/^\/api\/registry\/\d+$/) && method === 'DELETE') {
    const index = parseInt(path.split('/').pop());
    const routes = loadApiRegistry();
    
    if (index < 0 || index >= routes.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'API不存在' }));
      return;
    }

    const removed = routes.splice(index, 1)[0];
    saveApiRegistry(routes);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, removed }));
    return;
  }

  // 同步API
  if (path === '/api/sync' && method === 'POST') {
    const synced = syncRegistry();
    const routes = loadApiRegistry();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      success: true, 
      count: routes.length,
      synced
    }));
    return;
  }

  // 重新分类所有API
  if (path === '/api/reclassify' && method === 'POST') {
    const routes = loadApiRegistry();
    routes.forEach(route => {
      route.module = getModule(route.path);
      route.autoDescription = getAutoDescription(route.method, route.path);
    });
    saveApiRegistry(routes);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: routes.length }));
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Not Found' }));
});

// 启动时同步
syncRegistry();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Manager 运行在 http://0.0.0.0:${PORT}`);
});
