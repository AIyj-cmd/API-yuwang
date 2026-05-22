// API 模块定义
export const MODULE_DEFINITIONS = {
  auth: {
    name: '用户认证',
    icon: '🔐',
    description: '注册、登录、用户信息管理'
  },
  admin: {
    name: '管理后台',
    icon: '👑',
    description: '后台管理功能：记录审核、用户管理、配置等'
  },
  records: {
    name: '摸鱼记录',
    icon: '🐟',
    description: '记录的增删改查、互动、评论、分享'
  },
  users: {
    name: '用户系统',
    icon: '👤',
    description: '用户资料、个人主页、成就'
  },
  guilds: {
    name: '工会系统',
    icon: '⚔️',
    description: '工会创建、加入、排名、任务'
  },
  circles: {
    name: '圈子系统',
    icon: '⭕',
    description: '兴趣圈子、加入、动态、排名'
  },
  groups: {
    name: '小组系统',
    icon: '👥',
    description: '私密小组、邀请码、挑战、排名'
  },
  leaderboards: {
    name: '排行榜',
    icon: '🏆',
    description: '各类排行榜数据'
  },
  community: {
    name: '社区广场',
    icon: '📢',
    description: '公共内容流、热门内容'
  },
  notifications: {
    name: '消息通知',
    icon: '🔔',
    description: '通知列表、已读状态'
  },
  wallet: {
    name: '鱼鳞钱包',
    icon: '💰',
    description: '虚拟货币余额、交易记录'
  },
  badges: {
    name: '徽章成就',
    icon: '🏅',
    description: '徽章、成就系统'
  },
  topics: {
    name: '话题系统',
    icon: '#️⃣',
    description: '热门话题、话题详情'
  },
  search: {
    name: '搜索功能',
    icon: '🔍',
    description: '全站搜索'
  },
  stats: {
    name: '统计数据',
    icon: '📊',
    description: '站点统计'
  },
  checkins: {
    name: '签到系统',
    icon: '✅',
    description: '每日签到'
  },
  feedback: {
    name: '反馈建议',
    icon: '💡',
    description: '用户反馈'
  },
  system: {
    name: '系统功能',
    icon: '⚙️',
    description: '健康检查、配置、公告'
  },
  other: {
    name: '其他',
    icon: '📦',
    description: '未分类接口'
  }
};

// 根据路径获取模块
export function getModule(path) {
  const parts = path.replace('/api/', '').split('/');
  const firstPart = parts[0];

  // 精确匹配
  const moduleMap = {
    'auth': 'auth',
    'admin': 'admin',
    'records': 'records',
    'record': 'records',
    'users': 'users',
    'user': 'users',
    'guilds': 'guilds',
    'circles': 'circles',
    'groups': 'groups',
    'leaderboards': 'leaderboards',
    'community': 'community',
    'notifications': 'notifications',
    'wallet': 'wallet',
    'badges': 'badges',
    'topics': 'topics',
    'search': 'search',
    'stats': 'stats',
    'health': 'system',
    'options': 'system',
    'announcements': 'system',
    'suggestions': 'feedback',
    'checkins': 'checkins'
  };

  return moduleMap[firstPart] || 'other';
}

// 根据路径和方法生成简要描述
export function getAutoDescription(method, path) {
  const parts = path.replace('/api/', '').split('/');
  const isDynamic = parts.some(p => p.startsWith(':'));

  // 通用描述模板
  const actionMap = {
    'GET': isDynamic ? '获取详情' : '获取列表',
    'POST': '创建/提交',
    'PUT': '更新',
    'PATCH': '更新',
    'DELETE': '删除'
  };

  const action = actionMap[method] || '操作';
  
  // 特殊路径处理
  if (path.includes('/join')) return '加入';
  if (path.includes('/leave')) return '退出';
  if (path.includes('/like')) return '点赞';
  if (path.includes('/report')) return '举报';
  if (path.includes('/comment')) return '评论';
  if (path.includes('/share')) return '分享';
  if (path.includes('/ranking')) return '获取排名';
  if (path.includes('/feed')) return '获取动态';
  if (path.includes('/members')) return '获取成员';
  if (path.includes('/tasks')) return '获取任务';
  if (path.includes('/login')) return '登录';
  if (path.includes('/logout')) return '退出登录';
  if (path.includes('/register')) return '注册';
  if (path.includes('/me')) return '获取当前用户';
  if (path.includes('/status')) return '更新状态';
  if (path.includes('/review')) return '审核';
  if (path.includes('/read')) return '标记已读';
  if (path.includes('/search')) return '搜索';
  if (path.includes('/popular')) return '获取热门';
  if (path.includes('/hot')) return '获取热门';
  if (path.includes('/current')) return '获取当前';
  if (path.includes('/my')) return '获取我的';

  return action;
}
