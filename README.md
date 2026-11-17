# 沙漠掘金 · 多人实时网页沙盘

把传统「沙漠掘金」培训沙盘搬到网页上：8 队同时在线，各自在大本营采购、逐格推进、赌天气、挖金子、比谁活着回来赚得多。管理员一个后台控全场，**所有规则参数、地图、天气、价格、金价、计时都能改**，不用改代码。

- 玩家端：`/play` —— 沙盘地图 + 资源舱 + 决策台 + 商店/情报/规则/日报/终局排行
- 管理端：`/admin` —— 指挥台、参数中心、天气矩阵、地图编辑器、队伍与账号、报表导出、播报、审计日志、改密
- 大屏端：`/screen` —— 1920×1080 投屏，全员地图、金价榜、天候、在场队伍、滚动播报、超大倒计时
- 登录页：`/` —— 队伍 / 管理员双入口

视觉是「夜色沙丘 + 近黑分层 + 沙金发丝线」的路子，沙尘暴会震屏、高温会烤红边缘、倒计时最后 30 秒心跳变红，不是老培训 PPT 那种蓝白配色。

---
## 1. 30 秒跑起来（本机 / 有 Node 的服务器）

```bash
cd desert-gold
node -v                 # 需要 Node >= 20（推荐 22）
npm install             # 已带 package-lock.json
node server.js          # 默认 http://localhost:3000
```

首次启动会自动建库、建管理员、建 8 支演示队伍和一个 25 天的默认局。

| 角色 | 账号 | 密码 |
|---|---|---|
| 管理员 | `A` | `Aa0123456789` |
| 演示队伍 1–8 | `team01` … `team08` | `desert888` |

> 管理员账号只在「库里还没有这个用户名」时创建；改密请在后台「账号安全」里改，之后 `.env` 里的 `ADMIN_PASS` 不再起作用。

---
## 2. 上云：Docker 一条命令

```bash
# 服务器上（Ubuntu/Debian 均可，装好 Docker 与 compose 插件）
git clone <你的仓库> desert-gold && cd desert-gold
cp .env.example .env      # 改 ADMIN_PASS / JWT_SECRET
docker compose up -d --build
docker compose logs -f    # 看到「沙盘已启动」即可
```

访问 `http://服务器IP:8080/`，管理员进 `/admin`，投屏机开 `/screen`。

- 数据库落在宿主机 `./data/desert-gold.db`，删容器不丢局；`./data/.jwt-secret` 是登录密钥，**换机器要一起带走**，否则所有人需要重新登录。
- 想换端口：改 `docker-compose.yml` 里的 `"8080:3000"` 左边。
- 内网培训直接这么用就行；要公网 + 域名，建议前面挂一层 Caddy/Nginx 做 HTTPS（见下）。

### HTTPS 反代（Caddy，最省事）

```caddyfile
gold.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

然后把 `.env` 里 `HTTPS=true` 打开并重启容器（Cookie 会带 Secure）。Socket.IO 走同域 WebSocket，反代不需要额外配置。

### 不上 Docker 的 systemd 写法

```ini
[Unit]
Description=Desert Gold
After=network.target

[Service]
WorkingDirectory=/opt/desert-gold
ExecStart=/usr/bin/node server.js
Environment=PORT=3000 DATA_DIR=/opt/desert-gold/data
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

---
## 3. 后台能改什么（对应 PPT / 两张记录表）

「参数中心」一页改完，点「保存全部参数」即刻生效并广播给所有在线玩家：

| 分组 | 可改项 |
|---|---|
| 起始资源 | 现金、载重上限、初始水/食物、帐篷次数、指南针 |
| 价格与重量 | 水（基地价/村庄倍率/单位重量）、食物、帐篷（价格/重量/可用次数）、指南针、金子重量与每日产量 |
| 天候消耗 | 16 项（晴/高温/沙尘暴/沙暴+高温 × 沙漠/村庄/绿洲/古墓/藏宝山/大本营）每项的水、食物、帐篷、指南针 |
| 规则开关 | 归零即死、大本营免消耗、抵达即挖、帐篷指南针互斥、村庄水换粮、全员提交自动结算、收队提前秒数、超时策略 |
| 金价经济 | 计价方式（按块 / 按磅）、归营金价序列、税率、挖金最多免税 |
| 计时 | 准备、简报、第 1 天、常规日、日报各阶段秒数，预警秒数 |
| 任务文案 | 标题、副标题、简报、胜利条件 |
| 情报 | 水/食物价格、是否独占、情报条目（含「预知天候 / 山中取水 / 古墓罗盘」等效果） |

另外三块也是全图形化：

- **天气矩阵**：25×6 的下拉表格，逐天逐地形指定 晴 / 高温 / 沙尘暴 / 沙暴+高温，改完立即生效。
- **地图编辑器**：38 个节点的 id、名称、地形、坐标 + 邻接表（改 id 会自动重写边引用），右侧实时预览、连通性校验、平衡测算（最短到山、往返天数、可挖天数、单块金收益、税后净收益）。
- **队伍与账号**：新建、CSV 批量导入（`名称,口号,颜色`）、改名改色、判死/复活/重置/删除、批量重置密码。

预设三键：`PPT`（原始 PPT 口径）/ `TABLE`（按记录表口径，含沙尘暴连困 2 天）/ `CLASSIC`（经典版，村庄水换粮、按磅计价）。**载入预设只覆盖价格/消耗/经济/起始/规则，不动你改过的地图、天气、总天数、计时和文案。**

---
## 4. 规则实现要点（已单测覆盖）

- 地图 38 格：大本营 1、沙漠 20、村庄 7、绿洲 2、古墓 1、藏宝山 1…（以编辑器为准，可任意改）。
- 相邻格才能走，一天一步；原地留守也消耗当天口粮。
- 天气按「地形 + 当天矩阵」取值，消耗表可自定义；沙尘暴可配置成「困住 N 天」。
- **大本营免消耗**：开局只有 1000 元现金、0 水 0 食物，队伍在基地扎营不扣粮、不判死，逼你先采购再出门。
- 归营判定：只有**从外面走回**大本营才算归营并进入金价榜，开局原地不动不会被误判成「已归营」。
- 金子按块计价或按磅计价；归营金价按名次取序列（默认 1000 / 900 / 850…）；利润按税率抽税，挖金最多的队伍免税（可关）。
- 超载：采购与拾金都实时校验剩余载重，超了不给提交。
- 全员提交 → 自动提前结算；到点未交按「原地停留」处理，不会卡局。
- 结算 → 每人一份日报（行程、消耗、采购、账目、结余、建议、备注），并可导出 xlsx。

跑测试：

```bash
node --test tests/engine.test.js      # 14 pass
```

> 注意 `node --test tests/` 在部分 Node 版本不认目录，请直接指文件。

---
## 5. 数据、备份、恢复

- 单文件 SQLite：`${DATA_DIR}/desert-gold.db`，含 users / sessions / teams / reports / audit_logs。
- 备份（Docker 部署）：`bash scripts/backup.sh`，产物在 `backups/`，默认保留 14 天。
- 手工备份也行：停容器 → 拷贝 `data/` 整个目录。恢复就是把它放回去再起容器。
- 审计日志在后台「审计日志」页，记录谁在什么时候改了什么（前后值都有）。

---
## 6. 技术栈与目录

```
server.js              Express 5 + Socket.IO 装配、静态资源、/healthz
src/db.js              better-sqlite3 建表、迁移、uid/时间工具
src/auth.js            bcrypt + JWT(httpOnly cookie)，管理员/队伍两种角色
src/routes.js          全部 REST 接口（登录、玩家、大屏、后台）
src/service.js         局状态机：开营/暂停/延长/跳阶段/结算/结束/重置、在线状态、广播
src/engine/config.js   配置基线、三套预设、天气矩阵、地图默认数据
src/engine/settle.js   单队结算（移动/消耗/天气/帐篷/指南针/挖金/归营/死亡）
src/engine/rules.js    消耗表、载重、采购、情报
src/engine/score.js    归营金价、抽税、排名
public/                四个页面 + theme.css 设计系统 + map.js Canvas 渲染器
tests/engine.test.js   14 项规则单测
```

**与最初提示词的技术偏差（有意为之）**：提示词里写的是 Next.js + PostgreSQL + Redis + BullMQ 五容器；实际交付改成 **单进程 Express + SQLite（WAL）**。原因是这游戏一场最多几十人在线、状态全在内存 + 一个库文件里就够，单容器起停最快、备份最简单，租一台 2C2G 的轻量服务器就能跑；真要多场并行再拆库也不难（配置和结算逻辑与存储解耦）。

---
## 7. 主要接口（需要时对接你自己的系统）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{username,password,mode:'admin'\|'player'}` |
| GET | `/api/auth/me` | 当前身份 |
| POST | `/api/auth/password` | 改密 |
| GET | `/api/player/state` | 玩家全量状态（含地图、价格、规则、天气、日报） |
| POST | `/api/player/action` | `{clientActionId, action}`，幂等 |
| DELETE | `/api/player/action` | 撤回当天行动 |
| GET | `/api/player/reports` | 历史日报 |
| GET | `/api/screen/state` | 大屏数据（含全员位置） |
| GET | `/api/admin/state` | 后台全量状态 |
| POST | `/api/admin/session/:id/{open\|pause\|resume\|extend\|settle\|end\|reset\|skip}` | 控节奏 |
| PATCH | `/api/admin/config?sessionId=` | 改参数 |
| PUT | `/api/admin/weather` | 改天气矩阵 |
| PUT | `/api/admin/map` / `POST /api/admin/map/preview` / `reset` | 改地图 / 校验 / 恢复默认 |
| GET | `/api/admin/balance` | 平衡测算 |
| POST | `/api/admin/session/:id/preset` | 载入预设 |
| POST/PATCH/DELETE | `/api/admin/teams...` | 队伍增删改 |
| POST | `/api/admin/users/reset` | 批量重置密码 |
| POST | `/api/admin/broadcast` | 播报 |
| GET | `/api/admin/audit` | 审计日志 |
| GET | `/api/admin/export?type=daily\|cost\|final&day=` | 导出 xlsx |

Socket 事件：`game:refresh`、`dayStart`、`phase`、`dayEnd`、`report`、`ended`、`game:toast`。前端同时保留 6 秒轮询兜底，断网重连不会漏状态。

---
## 8. 现场操作

见 [`docs/操作手册.md`](docs/操作手册.md)：开营前检查清单、主持节奏、突发处理（掉线/超时/判死误操作/换地图）、收尾导出与颁奖。

## 9. 托管：Cloudflare Workers + Durable Objects（$0，主机关掉也能玩）

仓库根目录的 `wrangler.jsonc` + `cf/` 是 Cloudflare 版实现，和 Express 版**共用同一套规则引擎**（`src/engine/*` 原样复用，14 项单测不受影响）。Cloudflare 会从仓库自动构建部署，别人打开分配的 `*.workers.dev` 网址即可登录开玩，不依赖你的电脑。

- **入口**：`cf/worker.js`（路由 + 静态页映射），`cf/game.js`（Durable Object：状态机、SQLite 存储、WebSocket 广播、WebCrypto 鉴权）。
- **一场沙盘 = 一个 Durable Object**，状态存在 `ctx.storage.sql`，免费版可用（SQLite 后端）。倒计时用 DO alarm + 请求懒推进，不做每秒轮询，省请求额度。
- **实时层**：DO 原生 WebSocket 替代 Socket.IO，前端 `public/js/api.js` 在检测不到 `window.io` 时自动回落，事件名与 Express 版一致。
- **免费额度**（2026 年现行）：Workers 约 10 万请求/天，DO SQL 存储 5GB，无需绑卡。

### 在 Cloudflare 控制台接仓库

1. Workers & Pages → 创建 → 连接到 Git → 选 `Aslam50-3/desert-gold`。
2. 项目名 `desert-gold`；构建命令 **`npm ci`**；部署命令 **`npx wrangler deploy`**；预览命令留空、预览构建关掉即可。
3. 点「部署」。构建日志里应看到 `wrangler deploy` 上传 `desert-gold`，并完成 Durable Object 迁移 `v1`。
4. 打开 `https://desert-gold.<你的子域>.workers.dev`。

### 账号

| 角色 | 账号 | 口令 |
| --- | --- | --- |
| 管理员 | `A` | `Aa0123456789` |
| 队伍（8 支） | `team01` … `team08` | `desert888` |

登录后可改密码；管理员口令也可在 Cloudflare 项目的 Variables 里改 `ADMIN_PASS`（注意：已在库里初始化的账号不会自动改密，需在后台「账号安全」重置，或新开一个 DO 实例）。

### Cloudflare 版与 Express 版的行为差异

- 后台「报表导出」在免费版返回 **CSV**（不引入 ExcelJS，避免超出 CPU 限制）。
- 只有一场沙盘（DO 名 `main`）；「重置本局（保留队伍）」可用，多局归档留给付费版/自托管。
- 未做每账号在线人数精确统计以外的会话管理；WebSocket 断开后前端 3 秒自动重连。
- 本机验证方式：`npx wrangler dev --port 8788`，已跑通登录、开营、提交、结算、日报、25 天终局、评分、队伍增删、参数/天气修改、WebSocket 广播与页面渲染。

### 其它路线

`docs/托管与Cloudflare.md` 保留了对比：Cloudflare Pages 只能静态托管（登录/结算跑不了）；Containers 是公开 beta 且按量计费；Oracle/GCP 免费 VM 需绑卡。要「别人点开就能玩 + 不花钱」，当前这条 Workers + DO 路线是成本最低且已验证可跑的。

仓库自带 `.github/workflows/ci.yml`：每次 push 自动安装依赖、跑 14 项规则单测、启动服务并探活 `/healthz`。
