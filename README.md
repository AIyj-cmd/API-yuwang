# 🔌 API-yuwang

API 接口管理工具 - 为 yuwang 项目提供可视化的 API 文档管理界面

## ✨ 功能特性

- 📊 **接口总览** - 一目了然查看所有 API 接口
- 🏷️ **模块分类** - 按功能模块自动分类（用户、店铺、积分、订单等）
- 🔍 **智能筛选** - 按方法、类型、风险等级、前端状态筛选
- 📝 **详情查看** - 点击查看接口完整信息（参数、响应、权限）
- 🔄 **变更检测** - 自动标记新增和修改的接口
- 📤 **多种导出** - 支持 Markdown 和 OpenAPI 3.0 格式导出
- 🧪 **接口测试** - 直接在页面测试 API 接口
- 📈 **覆盖率统计** - 查看前端接口接入情况

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- PM2（可选，用于进程管理）

### 安装部署

```bash
# 克隆项目
git clone https://github.com/AIyj-cmd/API-yuwang.git
cd API-yuwang

# 启动服务
node server.js

# 或使用 PM2
pm2 start server.js --name api-manager -- 3003
```

### 访问

打开浏览器访问 `http://your-server-ip:3003`

## 📁 项目结构

```
API-yuwang/
├── server.js                  # 后端服务（Node.js HTTP 服务）
├── index.html                 # 前端页面
├── app.js                     # 前端逻辑
├── style.css                  # 样式文件
├── modules.js                 # 模块定义和分类
├── api-registry-analyzed.json # API 接口数据
├── analyze.js                 # 代码分析脚本
├── frontend-usage.json        # 前端使用情况
└── modules-config.json        # 自定义模块配置
```

## 🔧 配置说明

### 修改端口

编辑 `server.js` 第 9 行：

```javascript
const PORT = 3003; // 修改为你想要的端口
```

### 关联 yuwang 项目

如果需要从 yuwang 项目同步接口，修改 `server.js` 顶部配置：

```javascript
const YUWANG_SERVER_DIR = '/root/yuwang/server';  // yuwang 服务端目录
const YUWANG_BASE_URL = 'http://localhost:3001';   // yuwang 服务地址
```

### 自定义模块

在 `modules-config.json` 中添加自定义模块：

```json
{
  "custom": {
    "newModule": { "name": "新模块", "icon": "🆕", "color": "#10b981" }
  }
}
```

## 📊 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/registry` | GET | 获取所有接口数据 |
| `/api/modules` | GET | 获取模块配置 |
| `/api/modules` | POST | 添加自定义模块 |
| `/api/modules` | DELETE | 删除自定义模块 |
| `/api/sync` | POST | 从 yuwang 同步数据 |
| `/api/proxy/*` | ANY | 代理请求到 yuwang 服务 |

## 🎯 使用说明

1. **查看接口** - 点击接口行查看详情
2. **筛选接口** - 使用顶部筛选器按模块、方法、状态筛选
3. **导出文档** - 点击 "Markdown" 或 "OpenAPI" 按钮导出
4. **刷新数据** - 点击 "🔄 刷新获取新增" 检测新接口
5. **测试接口** - 在详情弹窗点击 "🧪 测试接口"

## 🛠️ 技术栈

- **后端**: Node.js (原生 HTTP 模块，无依赖)
- **前端**: 原生 HTML/CSS/JavaScript
- **进程管理**: PM2

## 📄 许可证

MIT License

## 👤 作者

**AIyj-cmd**

- GitHub: [@AIyj-cmd](https://github.com/AIyj-cmd)
