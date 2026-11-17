# 托管说明：GitHub、Cloudflare 与「关掉电脑还能玩」

> **2026-11 更新：Cloudflare 版已经落地。** 仓库里的 `cf/` + `wrangler.jsonc` 是 Workers + Durable Objects 原生实现，免费版可用，已部署在 <https://tuzb0413.eu.cc>。下面「方案 C」的描述是当时的调研记录，实际实现见 README 第 9 节。

这份文档解释一个容易被 Cloudflare 宣传页误导的问题：**这个项目不是静态网站，Cloudflare Pages 连上仓库后能打开页面，但登录、采购、结算、地图同步全都会失效。**

原因很直接：

| 本项目依赖 | Cloudflare Pages（静态托管） |
|---|---|
| 常驻 Node 进程 + 每秒推进阶段的定时器 | 只发静态文件，没有进程 |
| 本地 SQLite 文件 `data/desert-gold.db` | 没有可写磁盘 |
| Socket.IO 长连接（实时刷新棋盘/倒计时） | 只有静态资源，没有服务端 |

所以「GitHub + Cloudflare Pages」这条路只能给你一个**看起来像登录页的静态外壳**，队伍一登录就报错。要真的让别人玩起来，有三条可行路线。

---

## 方案 A：GitHub 仓库 + 云主机 / 容器平台（推荐，代码零改动）

仓库只负责版本管理和自动测试，运行交给一台常驻机器：

```bash
git clone https://github.com/<你>/desert-gold.git
cd desert-gold
cp .env.example .env        # 改 ADMIN_PASS / JWT_SECRET
docker compose up -d --build # http://<公网IP>:8080
```

- 成本：2C2G 轻量云服务器约 ¥30–40/月；香港/新加坡节点国内访问更快。
- 优点：`data/` 落在磁盘上，备份就是拷一个文件；Socket.IO 原生可用；出问题能 SSH 进去看日志。
- 同类 PaaS（Fly.io / Railway / Zeabur）也能直接跑这个 Dockerfile + 挂一个持久卷，不用自己运维系统，$5 上下/月。

## 方案 B：Cloudflare Containers（可以把现成镜像跑上去，但仍是 beta）

Cloudflare 在 2025 年 6 月开放了 Containers 公开测试：把 Docker 镜像交给 Cloudflare 跑，前面挂一个 Worker 当路由。这个项目的 Dockerfile 可以直接用，但要接受三件事：

1. **实例会休眠**：没有请求就缩容，下一次请求要冷启动（约数秒），开局瞬间体验不如常驻机器。
2. **磁盘默认是临时的**：SQLite 文件要靠「快照」恢复，需要在每轮结算后打快照、启动时读回——这是要额外写的代码，不是配置一下就好。
3. **按秒计费且需 Workers 付费计划**：1 GiB / ¼ vCPU 常驻粗算约 $19/月，只在开课时段运行才便宜。

适合「我就是想全部放在 Cloudflare」，不适合「明天就要开场」。

## 方案 C：改写成 Cloudflare 原生（Workers + Durable Objects）

这是唯一能做到「GitHub 推代码 → Cloudflare 自动部署 → 别人直接访问、且几乎零运维」的形态，也是这个游戏最合适的云原生结构：

- 一局 = 一个 Durable Object：状态、SQLite 存储、WebSocket 广播都在里面；
- 倒计时用 DO 的 `alarm` 代替 `setInterval`；
- 前端把 Socket.IO 换成原生 WebSocket（或直接 6 秒轮询，代码已有轮询兜底）；
- REST 层换成 Hono/itty-router，静态页面交给 Workers Assets 或 Pages。

代价：服务端的局状态机、结算入口、导出 xlsx 要重写一遍（规则引擎 `src/engine/*` 可整体复用，前端大部分可保留），约 1–2 天。费用基本只有 Workers 付费计划 $5/月。

---

## GitHub 仓库这一侧（已经准备好的部分）

仓库里已经包含：

- `Dockerfile` / `docker-compose.yml` / `.env.example` / `.dockerignore`
- `README.md`、`docs/操作手册.md`、本文件
- `.github/workflows/ci.yml`：每次 push 自动 `npm ci` → 跑 14 项规则单测 → 启动服务并请求 `/healthz`

推上去之后，GitHub Actions 会替你守住「改坏了规则」这条底线；Cloudflare 那边不管选 B 还是 C，都能直接从这个仓库构建。

## 需要你提供的东西

1. 在 GitHub 新建一个**空仓库**（不要勾选 README / .gitignore），公开或私有都行；
2. 仓库地址，例如 `github.com/yourname/desert-gold`；
3. 一个只对这个仓库生效的 fine-grained token，权限勾 **Contents: Read and write**（如果以后想让 Actions 自动部署，再补 **Workflows: Read and write**）。

拿到后我会：推代码 → 确认 Actions 绿灯 → 再按你选的方案接 Cloudflare 或云主机。
