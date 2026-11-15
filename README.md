# SuperAI Monitor — GitHub Actions 版

**Mac 关机也能推送**：GitHub Actions 每 5 分钟在云端跑 `monitor.js`，用 Web Push 直接推到手机。

## 1. 仓库结构

```
superai-monitor/
  monitor.js              # 链上监测（SIP/BNB/sSOL/sTRX/USDC/新池/mint）
  gpt-monitor.js          # GPT/OpenAI 状态
  package.json            # web-push
  state.json              # 监测基线（Actions 自动 commit）
  gpt-state.json          # GPT 基线
  pages/                  # GitHub Pages PWA
    index.html
    sw.js
    manifest.json
    config.js             # VAPID 公钥
    icon-192.png
    icon-512.png
  .github/workflows/
    monitor.yml           # 每 5 分钟
    gpt.yml               # 每 15 分钟
    pages.yml             # 部署 PWA
```

## 2. 一次性配置

### 2.1 取 VAPID 密钥

本机：

```bash
cd superai-monitor
cat push/vapid.json
```

会看到：

```json
{ "publicKey": "B...", "privateKey": "..." }
```

### 2.2 GitHub Secrets

仓库 **Settings → Secrets and variables → Actions → New repository secret**：

| Secret | 值 |
|---|---|
| `VAPID_PUBLIC_KEY` | `publicKey` |
| `VAPID_PRIVATE_KEY` | `privateKey` |
| `PUSH_SUBSCRIPTION` | 先留空，手机订阅后填 |

### 2.3 开启 GitHub Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions**。

推送 `pages/` 后，`pages.yml` 会部署，得到：

```
https://<你的用户名>.github.io/<仓库名>/
```

## 3. 手机订阅

1. Android Chrome 打开 Pages 地址；
2. 菜单 → **安装应用 / 添加到主屏幕**；
3. 打开 App → 勾选主题 → **开启通知**；
4. 点 **复制订阅 JSON**；
5. 回 GitHub → **PUSH_SUBSCRIPTION** → 粘贴 JSON → 保存；
6. Actions → **SuperAI Monitor** → **Run workflow** 手动跑一次。

手机就会收到测试/链上通知。

## 4. 运行

- `monitor.yml`：`*/5 * * * *`（GitHub 可能延迟几分钟）
- `gpt.yml`：`*/15 * * * *`
- 每次跑完把 `state.json` / `gpt-state.json` 提交回仓库，保持基线。

## 5. 限制

- GitHub cron 最小 5 分钟，可能有延迟；
- Actions 运行器是临时的，**状态靠 commit 回仓库**；
- 只有一个用户，所以订阅直接放 `PUSH_SUBSCRIPTION` Secret；
- 不要把 `push/vapid.json`、`subscriptions.json`、`.env` 提交进仓库；
- 网页必须 HTTPS（GitHub Pages 自带）。

## 6. 本地测试（可选）

```bash
npm install
node monitor.js --once
node gpt-monitor.js --once
```

有 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `PUSH_SUBSCRIPTION` 环境变量时，会直接发 Web Push；没有时只写日志。
