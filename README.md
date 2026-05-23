# 🔌 API-yuwang

API 接口治理平台 — 为 yuwang 项目提供可视化的 API 文档管理、权限审计、生命周期追踪和发布前检查

## ✨ 功能特性

### 核心管理
- 📊 **接口总览** — 一目了然查看所有 API 接口，健康度仪表盘
- 🏷️ **模块分类** — 按功能模块自动分类，支持自定义模块扩展
- 🔍 **智能筛选** — 按方法、类型、风险等级、前端状态、测试状态多维筛选
- 📝 **详情编辑** — 点击查看/编辑接口完整信息（描述、标签、权限、风险等级）
- 🔄 **源码扫描** — 从 yuwang 源码自动发现新增接口
- 📤 **多种导出** — 支持 Markdown、OpenAPI 3.0、选中导出

### 治理工具
- 🛡️ **权限矩阵** — 模块 × 权限级别矩阵，自动检测反模式（admin 接口暴露、权限过低、内部接口外泄）
- ♻️ **生命周期管理** — planned → active → needs_review → deprecated → removed 全流程追踪
- 🔍 **变更影响分析** — 对比源码变更，评估影响范围和风险等级
- 🧬 **重复接口识别** — 路径相似 + 名称语义相似 + 模块功能冗余检测
- 🚀 **发布前检查清单** — 一键生成发布检查报告（高风险/未测试/待审核/缺失接入等 7 项检查），支持导出 Markdown

### AI 辅助
- 🤖 **Claude 任务生成器** — 选择接口一键生成前端任务说明，支持模板生成和 DeepSeek AI 优化
- 🧠 **AI 语义分析** — DeepSeek 辅助分析重复接口，给出保留/合并/规范建议
- 💾 **草稿管理** — 任务草稿保存、预览、批量操作

### 测试与验收
- 🧪 **接口测试** — 通过 proxy 代理测试 API，支持 dryRun 模拟和真实请求
- 📋 **测试记录** — 自动记录每次测试的时间、状态码、响应时间、结论
- 📦 **功能包** — 将接口按功能打包，跟踪从规划到验收的全流程状态

### 安全
- 🔒 **安全加固** — CORS 白名单、登录限流、Session 清理、Auth 全拦
- 🔐 **登录认证** — SHA-256 密码哈希，HttpOnly Cookie

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- PM2（可选，用于进程管理）

### 安装部署

```bash
# 克隆项目
git clone https://github.com/AIyj-cmd/API-yuwang.git
cd API-yuwang

# 安装依赖（本项目零依赖，仅 Node.js 原生模块）

# 创建 .env 配置文件
cp .env.example .env
# 编辑 .env 填入实际配置
```

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `API_MANAGER_PORT` | 服务端口 | 3003 |
| `YUWANG_SERVER_DIR` | yuwang 服务端目录 | /root/yuwang/server |
| `YUWANG_BASE_URL` | yuwang 服务地址 | http://localhost:3001 |
| `API_MANAGER_SESSION_SECRET` | Session 密钥 | - |
| `API_MANAGER_ADMIN_USERNAME` | 管理员用户名 | admin |
| `API_MANAGER_ADMIN_PASSWORD` | 管理员密码（SHA-256 哈希） | - |
| `API_MANAGER_WRITE_BACK_TO_YUWANG` | 是否写回 yuwang 的 api-registry.json | false |
| `API_MANAGER_ALLOWED_ORIGIN` | CORS 白名单（逗号分隔），留空允许所有 | - |
| `DEEPSEEK_API_KEY` | DeepSeek API Key（AI 功能可选） | - |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | https://api.deepseek.com |
| `DEEPSEEK_MODEL` | DeepSeek 模型名 | deepseek-v4-pro |
| `API_MANAGER_ENABLE_AI_TASKS` | 启用 AI 任务生成 | false |

**生成密码哈希：**
```bash
echo -n "your-password" | sha256sum | awk '{print $1}'
```

### 启动服务

```bash
# 直接启动
node server.js

# 或使用 PM2
pm2 start server.js --name api-manager

# 访问
# http://your-server-ip:3003
```

### Nginx 反代（可选）

```nginx
server {
    listen 3005;
    server_name _;

    location / {
        root /root/api-manager;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3003;
        proxy_set_header Host $host;
        proxy_set_header Cookie $http_cookie;
    }
}
```

## 📁 项目结构

```
API-yuwang/
├── server.js                  # 后端服务（Node.js 原生 HTTP，零依赖）
├── modules.js                 # 模块定义和路径分类规则
├── index.html                 # 前端页面（单文件 SPA）
├── app.js                     # 前端逻辑（2700+ 行）
├── style.css                  # 样式文件
├── api-registry-analyzed.json # API 接口数据（registry）
├── .env.example               # 环境变量示例
└── .env                       # 环境变量配置（不提交到 git）
```

运行时自动生成的数据文件（已 gitignore）：
- `modules.json` — 自定义模块配置
- `test-records.json` — 接口测试记录
- `claude-task-drafts.json` — Claude 任务草稿
- `feature-packs.json` — 功能包数据

## 📊 API 端点

### 认证
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/manager/auth/login` | POST | 管理员登录 |
| `/api/manager/auth/logout` | POST | 登出 |

### 接口管理
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/registry` | GET | 获取所有接口数据 |
| `/api/registry/:id` | PATCH | 更新接口元数据 |
| `/api/registry/:id` | DELETE | 删除接口 |
| `/api/scan` | GET | 扫描 yuwang 源码，返回新增接口 |
| `/api/sync` | POST | 同步 registry 并重新治理 |
| `/api/sync-changes` | POST | 批量添加/移除接口 |

### 模块与功能包
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/modules` | GET | 获取模块配置 |
| `/api/modules` | POST | 添加自定义模块 |
| `/api/feature-packs` | GET/POST | 功能包 CRUD |
| `/api/feature-packs/:id` | PATCH/DELETE | 更新/删除功能包 |

### Claude 任务
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/claude-tasks` | GET | 获取任务草稿列表 |
| `/api/claude-tasks/context` | POST | 获取任务上下文 |
| `/api/claude-tasks/generate-template` | POST | 模板生成任务 |
| `/api/claude-tasks/generate-ai` | POST | AI 优化生成（需 DeepSeek） |
| `/api/claude-tasks/:id` | PATCH/DELETE | 更新/删除草稿 |

### 测试与分析
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/proxy` | POST | 代理请求到 yuwang（支持 dryRun） |
| `/api/test-records` | GET/POST | 测试记录管理 |
| `/api/deepseek-status` | GET | 检查 DeepSeek 可用性 |
| `/api/dedup-analyze` | POST | DeepSeek 重复分析 |
| `/api/manager/config` | GET | 管理器配置（AI 开关等） |

## 🧪 接口测试

| 接口类型 | 按钮 | 行为 |
|----------|------|------|
| GET | 🚀 发送请求 | 真实请求后端 |
| POST/PATCH/PUT (普通) | 🧪 模拟请求 | dryRun，不写入数据 |
| DELETE / 高风险 / 管理员 | 🔒 模拟请求 | dryRun，后端也会拦截 |

## 🎯 使用说明

1. **登录** — 使用 .env 配置的用户名密码登录
2. **首页总览** — 查看健康度仪表盘、接口列表、筛选过滤
3. **功能分类** — 按模块查看接口，管理自定义模块
4. **权限矩阵** — 检测权限配置反模式
5. **生命周期** — 追踪接口从规划到废弃的全流程
6. **变更影响** — 对比源码变更评估影响
7. **Claude 任务** — 选择接口生成前端开发任务
8. **功能包** — 按功能打包接口，跟踪验收进度
9. **重复识别** — 发现疑似重复/废弃接口
10. **发布前检查** — 上线前一键生成检查报告

## 🛠️ 技术栈

- **后端**: Node.js（原生 HTTP 模块，零依赖）
- **前端**: 原生 HTML / CSS / JavaScript（单文件 SPA）
- **AI**: DeepSeek API（可选，用于任务生成和重复分析）
- **进程管理**: PM2
- **Web 服务器**: Nginx（可选反代）

## 📄 许可证

MIT License

## 👤 作者

**AIyj-cmd**
- GitHub: [@AIyj-cmd](https://github.com/AIyj-cmd)
