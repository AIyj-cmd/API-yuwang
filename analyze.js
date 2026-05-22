import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { MODULE_DEFINITIONS, getModule, getAutoDescription } from './modules.js';

const YUWANG_DIR = '/root/yuwang';
const SERVER_DIR = join(YUWANG_DIR, 'server');
const OUTPUT_PATH = join(import.meta.dirname, 'api-registry-analyzed.json');

// 读取文件
function readFile(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

// 分析权限类型
function analyzeAuth(routePath, fileContent, lineNum) {
  const lines = fileContent.split('\n');
  const contextStart = Math.max(0, lineNum - 5);
  const contextEnd = Math.min(lines.length, lineNum + 10);
  const context = lines.slice(contextStart, contextEnd).join('\n');

  if (routePath.includes('/admin/')) return 'admin';
  if (context.includes('requireAdmin')) return 'admin';
  if (context.includes('requireAuth')) return 'user';
  if (context.includes('getUserFromRequest')) return 'user';
  return 'anonymous';
}

// 分析风险等级
function analyzeRisk(method, path, authType, fileContent, lineNum) {
  const lines = fileContent.split('\n');
  const contextStart = Math.max(0, lineNum - 5);
  const contextEnd = Math.min(lines.length, lineNum + 15);
  const context = lines.slice(contextStart, contextEnd).join('\n');

  if (method === 'DELETE') return 'high';
  if (authType === 'admin') return 'high';
  if (context.includes('DELETE FROM') || context.includes('DROP ')) return 'high';
  if (context.includes('db.prepare') && (context.includes('INSERT') || context.includes('UPDATE'))) return 'medium';
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') return 'medium';
  return 'low';
}

// 分析关联数据库表
function analyzeDatabaseTables(fileContent, lineNum) {
  const lines = fileContent.split('\n');
  const contextStart = Math.max(0, lineNum - 10);
  const contextEnd = Math.min(lines.length, lineNum + 30);
  const context = lines.slice(contextStart, contextEnd).join('\n');

  const tables = new Set();
  const tableRegex = /(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/gi;
  let match;
  while ((match = tableRegex.exec(context)) !== null) {
    const table = match[1].toLowerCase();
    if (!['set', 'where', 'values', 'select'].includes(table)) {
      tables.add(match[1]);
    }
  }
  return Array.from(tables);
}

// 分析是否写审计日志
function analyzeAuditLog(fileContent, lineNum) {
  const lines = fileContent.split('\n');
  const contextStart = Math.max(0, lineNum - 5);
  const contextEnd = Math.min(lines.length, lineNum + 20);
  const context = lines.slice(contextStart, contextEnd).join('\n');
  return context.includes('writeAdminAuditLog') || context.includes('audit_log');
}

// 生成接口名称
function generateName(method, path) {
  const parts = path.replace('/api/', '').split('/');
  const resource = parts[0];
  
  const resourceNames = {
    'auth': '认证', 'users': '用户', 'records': '记录',
    'guilds': '工会', 'circles': '圈子', 'groups': '小组',
    'leaderboards': '排行榜', 'community': '社区', 'notifications': '通知',
    'wallet': '钱包', 'badges': '徽章', 'topics': '话题',
    'search': '搜索', 'stats': '统计', 'checkins': '签到',
    'health': '健康检查', 'options': '配置', 'announcements': '公告',
    'admin': '管理'
  };

  const actionMap = {
    'GET': parts.some(p => p.startsWith(':')) ? '获取详情' : '获取列表',
    'POST': '创建', 'PUT': '更新', 'PATCH': '更新', 'DELETE': '删除'
  };

  if (path.includes('/login')) return '登录';
  if (path.includes('/logout')) return '退出登录';
  if (path.includes('/register')) return '注册';
  if (path.includes('/me')) return '获取当前用户';
  if (path.includes('/join')) return '加入';
  if (path.includes('/like')) return '点赞';
  if (path.includes('/report')) return '举报';
  if (path.includes('/comment')) return '评论';
  if (path.includes('/share')) return '分享';
  if (path.includes('/ranking')) return '获取排名';
  if (path.includes('/feed')) return '获取动态';
  if (path.includes('/read')) return '标记已读';
  if (path.includes('/search')) return '搜索';

  const resourceName = resourceNames[resource] || resource;
  const action = actionMap[method] || '操作';
  return `${action}${resourceName}`;
}

// 解析路由定义
function parseRoutes(content, fileName) {
  const routes = [];
  const regex = /app\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    routes.push({
      method: match[1].toUpperCase(),
      path: match[2],
      file: fileName,
      line: content.substring(0, match.index).split('\n').length
    });
  }
  return routes;
}

// 主分析函数
function analyze() {
  console.log('🔍 开始分析 yuwang 项目 API...\n');
  
  // 读取后端代码
  const routesContent = readFile(join(SERVER_DIR, 'routes.ts'));
  const adminRoutesContent = readFile(join(SERVER_DIR, 'adminRoutes.ts'));
  
  // 解析路由
  const routes = parseRoutes(routesContent, 'routes.ts');
  const adminRoutes = parseRoutes(adminRoutesContent, 'adminRoutes.ts');
  const allRoutes = [...routes.map(r => ({ ...r, isAdmin: false })), 
                     ...adminRoutes.map(r => ({ ...r, isAdmin: true }))];
  
  // 读取前端使用情况
  let frontendUsage = {};
  try {
    frontendUsage = JSON.parse(readFile(join(import.meta.dirname, 'frontend-usage.json')));
  } catch {}
  
  console.log(`📊 发现 ${allRoutes.length} 个 API 接口`);
  console.log(`📱 前端调用 ${Object.keys(frontendUsage).length} 个 API\n`);
  
  // 分析每个路由
  const analyzedRoutes = allRoutes.map(route => {
    const fileContent = route.isAdmin ? adminRoutesContent : routesContent;
    const authType = analyzeAuth(route.path, fileContent, route.line);
    const riskLevel = analyzeRisk(route.method, route.path, authType, fileContent, route.line);
    const dbTables = analyzeDatabaseTables(fileContent, route.line);
    const hasAuditLog = analyzeAuditLog(fileContent, route.line);
    const name = generateName(route.method, route.path);
    
    // 接口类型
    let apiType = 'public';
    if (authType === 'admin') apiType = 'admin';
    else if (authType === 'user') apiType = 'authenticated';
    
    // 前端使用情况
    const frontendFiles = frontendUsage[route.path] || [];
    
    return {
      name,
      method: route.method,
      path: route.path,
      file: route.file,
      line: route.line,
      isAdmin: route.isAdmin,
      apiType,
      authType,
      riskLevel,
      status: 'implemented',
      frontendUsage: frontendFiles,
      dbTables,
      hasAuditLog,
      description: '',
      tags: [],
      favorite: false,
      module: getModule(route.path)
    };
  });
  
  // 统计
  const stats = {
    total: analyzedRoutes.length,
    byMethod: {}, byType: {}, byAuth: {}, byRisk: {},
    withoutFrontend: analyzedRoutes.filter(r => r.frontendUsage.length === 0).length,
    highRisk: analyzedRoutes.filter(r => r.riskLevel === 'high').length,
    withAuditLog: analyzedRoutes.filter(r => r.hasAuditLog).length
  };
  
  analyzedRoutes.forEach(r => {
    stats.byMethod[r.method] = (stats.byMethod[r.method] || 0) + 1;
    stats.byType[r.apiType] = (stats.byType[r.apiType] || 0) + 1;
    stats.byAuth[r.authType] = (stats.byAuth[r.authType] || 0) + 1;
    stats.byRisk[r.riskLevel] = (stats.byRisk[r.riskLevel] || 0) + 1;
  });
  
  console.log('📈 统计结果:');
  console.log(`  总计: ${stats.total} 个接口`);
  console.log(`  按权限: 匿名=${stats.byAuth.anonymous || 0}, 用户=${stats.byAuth.user || 0}, 管理员=${stats.byAuth.admin || 0}`);
  console.log(`  按风险: 低=${stats.byRisk.low || 0}, 中=${stats.byRisk.medium || 0}, 高=${stats.byRisk.high || 0}`);
  console.log(`  未接入前端: ${stats.withoutFrontend} 个`);
  console.log(`  高风险接口: ${stats.highRisk} 个`);
  console.log(`  写审计日志: ${stats.withAuditLog} 个`);
  
  // 保存结果
  writeFileSync(OUTPUT_PATH, JSON.stringify(analyzedRoutes, null, 2));
  console.log(`\n✅ 分析完成，已保存到 ${OUTPUT_PATH}`);
  
  return { routes: analyzedRoutes, stats };
}

analyze();
