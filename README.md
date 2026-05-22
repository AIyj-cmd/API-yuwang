# 🔌 API-yuwang

API 接口管理工具 - 为 yuwang 项目提供可视化的 API 文档管理界面

## ✨ 功能特性

- 📊 **接口总览** - 一目了然查看所有 API 接口
- 🏷️ **模块分类** - 按功能模块自动分类（用户认证、摸鱼记录、工会系统等）
- 🔍 **智能筛选** - 按方法、类型、风险等级、前端状态筛选
- 📝 **详情查看** - 点击查看接口完整信息（参数、响应、权限）
- 🔄 **源码扫描** - 从 yuwang 源码自动发现新增接口
- 📤 **多种导出** - 支持 Markdown 和 OpenAPI 3.0 格式导出
- 🧪 **接口测试** - 通过 proxy 代理测试 API，支持 dryRun 模拟
- 📈 **覆盖率统计** - 查看前端接口接入情况
- 🔐 **登录认证** - 支持用户名密码登录保护
- 🧩 **模块管理** - 支持自定义模块，持久化到 modules.json

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- PM2（可选，用于进程管理）

### 安装部署

```bash
# 克隆项目
git clone https://github.com/AIyj-cmd/API-yuwang.git
cd API-yuwang

# 创建 .env 配置文件
cp .env.example .env
```

### 配置 .env

```bash
API_MANAGER_PORT=3003
YUWANG_SERVER_DIR=/root/yuwang/server
YUWANG_BASE_URL=http://localhost:3001
API_MANAGER_SESSION_SECRET=your-random-secret
API_MANAGER_ADMIN_USERNAME=admin
API_MANAGER_ADMIN_PASSWORD=your-password-sha256-hash
API_MANAGER_WRITE_BACK_TO_YUWANG=false
API_MANAGER_ALLOWED_ORIGIN=
```

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
```

### 访问

打开浏览器访问 `http://your-server-ip:3003`

## 📁 项目结构

```
API-yuwang/
├── server.js                  # 后端服务（Node.js 原生 HTTP）
├── modules.js                 # 模块定义和路径分类规则
├── index.html                 # 前端页面
├── app.js                     # 前端逻辑
├── style.css                  # 样式文件
├── api-registry-analyzed.json # API 接口数据（registry）
├── modules.json               # 自定义模块配置（运行时生成）
├── .env.example               # 环境变量示例
└── .env                       # 环境变量配置（不提交到 git）
```

## 🔧 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `API_MANAGER_PORT` | 服务端口 | 3003 |
| `YUWANG_SERVER_DIR` | yuwang 服务端目录 | /root/yuwang/server |
| `YUWANG_BASE_URL` | yuwang 服务地址 | http://localhost:3001 |
| `API_MANAGER_SESSION_SECRET` | Session 密钥 | - |
| `API_MANAGER_ADMIN_USERNAME` | 管理员用户名 | admin |
| `API_MANAGER_ADMIN_PASSWORD` | 管理员密码（SHA-256 哈希） | - |
| `API_MANAGER_WRITE_BACK_TO_YUWANG` | 是否写回 yuwang 项目的 api-registry.json | false |
| `API_MANAGER_ALLOWED_ORIGIN` | CORS 允许的 origin 白名单（逗号分隔），留空则允许所有 | - |

### Nginx 部署（可选）

如果需要通过 Nginx 反代或使用其他端口：

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

## 📊 API 端点

| 端点 | 方法 | 认证 | 说明 |
|------|------|------|------|
| `/` | GET | 无 | 前端页面 |
| `/api/manager/auth/login` | POST | 无 | 管理员登录 |
| `/api/manager/auth/logout` | POST | 无 | 登出 |
| `/api/registry` | GET | 管理员 | 获取所有接口数据 |
| `/api/modules` | GET | 无 | 获取模块配置（内置 + 自定义） |
| `/api/modules` | POST | 管理员 | 添加自定义模块 |
| `/api/scan` | GET | 管理员 | 扫描 yuwang 源码，返回新增接口 |
| `/api/sync` | POST | 管理员 | 同步 registry 并重新整理 |
| `/api/sync-changes` | POST | 管理员 | 批量添加/移除接口 |
| `/api/registry/:id` | PATCH | 管理员 | 更新接口元数据 |
| `/api/registry/:id` | DELETE | 管理员 | 删除接口 |
| `/api/proxy` | POST | 管理员 | 代理请求到 yuwang（支持 dryRun） |

## 🧪 接口测试

测试面板根据接口类型自动区分行为：

| 接口类型 | 按钮 | 行为 |
|---|---|---|
| GET | 🚀 发送请求 | 真实请求后端 |
| POST/PATCH/PUT (普通) | 🧪 模拟请求 | dryRun，不写入数据 |
| DELETE / 高风险 / 管理员 | 🔒 模拟请求 | dryRun，后端也会拦截 |

## 🎯 使用说明

1. **登录** - 使用配置的用户名密码登录
2. **查看接口** - 点击接口行查看详情
3. **筛选接口** - 使用顶部筛选器按模块、方法、状态筛选
4. **导出文档** - 点击 "Markdown" 或 "OpenAPI" 按钮导出
5. **刷新获取新增** - 点击 "🔄 刷新获取新增" 扫描 yuwang 源码发现新接口
6. **测试接口** - 在详情弹窗点击 "🧪 测试接口"
7. **管理模块** - 在模块分类区域添加自定义模块

## 🛠️ 技术栈

- **后端**: Node.js (原生 HTTP 模块，零依赖)
- **前端**: 原生 HTML/CSS/JavaScript
- **进程管理**: PM2
- **Web 服务器**: Nginx（可选反代）

## 📄 许可证

MIT License

## 👤 作者

**AIyj-cmd**

- GitHub: [@AIyj-cmd](https://github.com/AIyj-cmd)
