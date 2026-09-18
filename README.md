# 🍚 点餐小屋

> 一个轻量、可爱的点餐系统 —— 厨师录入菜品，顾客按日历点餐，单文件数据库，双击即用。

![Go](https://img.shields.io/badge/Go-1.24-00ADD8?logo=go)
![License](https://img.shields.io/badge/License-MIT-green)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-blue)

---

## ✨ 功能亮点

- 🧑‍🍳 **厨师角色** — 设置密码保护，录入菜品（名称 / 照片 / 细分要求 / 时段分类），二级菜单查看顾客订餐（红点提示变动）
- 🍔 **顾客角色** — 无密码直入，日历视图浏览历史点餐，一键跳转今天，按 5 个时段自由选餐改餐
- 🎨 **卡通可爱风 UI** — 圆角渐变卡片、大字体大按钮，儿童老人友好
- 📱 **全设备响应式** — 电脑 / 平板 / 手机浏览器自适应
- 💾 **单文件数据库** — SQLite 存储全部数据（含照片 BLOB），拷走即迁移
- 🌏 **UTC+8 时区** — 日期始终附带星期显示
- 🚀 **零配置启动** — Windows 双击自动弹出浏览器，Linux 一行命令

---

## 📸 界面预览

| 角色选择 | 厨师 · 菜品管理 | 顾客 · 日历点餐 |
|:---:|:---:|:---:|
| 🧑‍🍳 / 🍔 | 📝 录入菜品 | 📅 日历 + 时段选餐 |

---

## 🏗️ 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Go 1.24 + `modernc.org/sqlite`（纯 Go，无 CGO） |
| 前端 | Vanilla JS SPA，嵌入 Go 二进制（`embed.FS`） |
| 数据库 | 单文件 SQLite（`food_data.db`），DELETE 日志模式 |
| 构建 | `build.bat` 一键交叉编译 Windows / Linux |

---

## 🚀 快速开始

### 下载 & 运行

**Windows：** 双击 `food_order_windows_amd64.exe`，浏览器自动打开

```
food_order_windows_amd64.exe port=18888
```

**Linux：**

```bash
chmod +x food_order_linux_amd64
./food_order_linux_amd64 port=18888
```

> 不指定 `port` 时默认监听 `18888`。

### 自行编译

```bash
# 安装依赖（需设置国内代理）
go env -w GOPROXY=https://goproxy.cn,direct
go mod tidy

# 一键编译双平台
build.bat

# 或手动编译
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o dist/food_order_windows_amd64.exe .
CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o dist/food_order_linux_amd64 .
```

---

## 📖 使用说明

### 厨师

1. 首次进入设置密码（≥4 位），之后需密码登录
2. **录入菜品** — 填写名称、上传照片、添加细分要求（加蛋、不要葱、微辣……）、选择时段（早餐 / 午餐 / 下午茶 / 晚餐 / 夜宵 / 全部时段）
3. **查看顾客订餐** — 按日期浏览，第一级显示时段概览（图标 + 份数 + 是否有更新），点击进入第二级查看详细菜品和需求

### 顾客

1. 无需登录，直接进入日历界面
2. 点击日期查看当天 5 个时段的点餐情况
3. 选择时段后可挑选菜品、勾选口味要求、调整数量
4. 支持修改已保存的订单

### 时段说明

| 时段 | Emoji | 说明 |
|---|---|---|
| 早餐 | 🌅 | breakfast |
| 午餐 | 🍚 | lunch |
| 下午茶 | 🍰 | afternoon |
| 晚餐 | 🍲 | dinner |
| 夜宵 | 🌙 | late |

> 菜品选择"全部时段"后会出现在每个时段的候选列表中。

---

## 📂 项目结构

```
food_system/
├── main.go              # Go 后端（API + SQLite + 静态文件服务）
├── static/
│   ├── index.html       # SPA 页面外壳
│   ├── style.css        # 卡通可爱风样式（响应式）
│   └── app.js           # 前端 SPA 逻辑
├── build.bat            # Windows 一键编译脚本
├── go.mod / go.sum      # Go 模块定义
└── dist/                # 编译产物（gitignore）
    ├── food_order_windows_amd64.exe
    └── food_order_linux_amd64
```

运行后同目录生成：

| 文件 | 说明 |
|---|---|
| `food_data.db` | 数据库（菜品 / 订单 / 照片，单文件） |
| `food_order.log` | 运行日志 |

---

## 🔌 API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/state` | 服务状态（是否设密码、是否已认证、今天日期） |
| `POST` | `/api/chef/setup` | 设置厨师密码 |
| `POST` | `/api/chef/login` | 厨师登录 |
| `POST` | `/api/chef/logout` | 厨师登出 |
| `GET` | `/api/dishes` | 获取全部菜品列表 |
| `POST` | `/api/dishes` | 新增菜品（multipart：name / options / slots / photo） |
| `PUT` | `/api/dishes/:id` | 编辑菜品 |
| `DELETE` | `/api/dishes/:id` | 删除菜品（软删除） |
| `GET` | `/api/photo/:id` | 获取菜品照片 |
| `PUT` | `/api/orders` | 保存某日某时段的订单 |
| `GET` | `/api/orders?date=YYYY-MM-DD` | 查询某日全部时段订单 |
| `GET` | `/api/orders/dates?month=YYYY-MM` | 日历标记（某月哪些天有订单） |
| `GET` | `/api/changes` | 厨师：查看订餐变动列表 |
| `POST` | `/api/changes` | 厨师：标记变动已读 |

---

## ⚙️ 设计决策

- **纯 Go SQLite 驱动**：使用 `modernc.org/sqlite` 而非 `mattn/go-sqlite3`，无需 CGO，交叉编译零障碍
- **照片存 BLOB**：图片直接写入 SQLite，避免外部文件依赖，单文件拷走即迁移
- **DELETE 日志模式**：禁用 WAL，确保数据库只有 `food_data.db` 一个文件（无 `-shm` / `-wal` 残留）
- **前端 embed**：HTML/CSS/JS 编译进二进制，部署时只需一个可执行文件

---

## 📜 License

MIT
