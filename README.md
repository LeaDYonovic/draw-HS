# 炉边画谜

基于炉石传说中文卡牌词库的多人实时“你画我猜”网页游戏。项目包含公共大厅、可配置房间、实时画板、选择题与卡牌搜索题，并支持单人 AI 测试。

## 功能

- 公共大厅、在线玩家列表、大厅聊天和房间聊天
- 自定义房间名称、规则、人数、轮数和答题时间
- 单人开局时自动加入“旅店老板 AI”
- 多人实时 Canvas 画板、画笔、橡皮和清屏
- 10 个同字数、带卡图和编号的选择题选项
- 按名称、字数、费用、攻击和生命检索卡牌，支持分页
- 围观正在进行的牌桌，并可申请从下一轮以 0 分加入
- 断线后凭本地会话令牌恢复房间
- 桌面和移动端响应式界面

词库包含 997 个不重复的中文卡牌名。卡牌 JSON 中的同名重印会优先选择当前核心版本，避免不同版本的属性和图片混用。

## 本地运行

需要 Node.js 20 或更高版本。

```powershell
npm ci
npm run dev
```

开发页面位于 `http://localhost:5173`，Socket.IO 服务位于 `http://localhost:3000`。

生产模式：

```powershell
npm ci
npm start
```

浏览器打开 `http://localhost:3000`。

## 验证

```powershell
npm run check
```

该命令会运行词库、搜索、房间状态机、AI、聊天、围观和中途加入测试，并执行 TypeScript 检查与 Vite 生产构建。GitHub Actions 会在每次推送和拉取请求时执行相同检查。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | ---: | --- |
| `PORT` | `3000` | Web 与 Socket.IO 监听端口 |
| `CARD_IMAGE_DIR` | `./card-images` | 卡牌图片缓存目录 |
| `MAX_ROOMS` | `100` | 同时存在的最大房间数 |
| `MAX_IMAGE_FETCHES` | `4` | 卡图回源最大并发数 |
| `MAX_IMAGE_FETCH_QUEUE` | `100` | 卡图回源等待队列上限 |
| `ALLOWED_ORIGINS` | 未设置 | 额外允许连接 Socket.IO 的来源，多个来源用逗号分隔；同源请求始终允许 |
| `TRUST_PROXY_HEADERS` | `false` | 是否在可信代理连接上读取 Cloudflare / Forwarded 客户端 IP |
| `TRUSTED_PROXY_ADDRESSES` | `127.0.0.1,::1` | 允许提供代理 IP 请求头的代理地址 |
| `ROUND_TIME_OVERRIDE_MS` | 未设置 | 测试用回合时长覆盖 |
| `ROUND_BREAK_OVERRIDE_MS` | 未设置 | 测试用回合间隔覆盖 |

## 树莓派部署

仓库包含 [`deploy/hearth-draw.service`](deploy/hearth-draw.service) systemd 配置。建议在服务器上使用 Node.js 22、`npm ci` 和反向代理 HTTPS：

```bash
cd /home/li/apps/hearth-draw
npm ci
npm run build
sudo cp deploy/hearth-draw.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hearth-draw
```

当前房间、积分和聊天保存在进程内存中，服务重启后会清空。卡牌图片缓存在 `CARD_IMAGE_DIR`，systemd 配置默认使用 `/var/lib/hearth-draw/card-images`。随附配置只信任树莓派本机的 Cloudflare Tunnel 代理头；如果代理运行在其他主机，需要同步修改 `TRUSTED_PROXY_ADDRESSES`。

## 说明

这是非商业同人项目。炉石传说及相关卡牌名称、图片和素材归其权利方所有。
