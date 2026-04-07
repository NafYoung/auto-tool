# 文旅公众号日报器

一个运行在本机 Mac 上的 Node.js 工具：用 Playwright 检查指定公众号是否有新文章，调用 DeepSeek 生成文旅日报，并通过 SMTP 发邮件。

现在支持两种运行模式：

- `本机模式`：搜狗搜索发现文章，适合你当前这台 Mac
- `云端模式`：RSS/Atom 订阅源发现文章，适合 GitHub Actions 或常开云主机

## 已实现的命令

```bash
npm run bootstrap
npm run check
npm run check -- --discovery-mode rss-only
npm run report -- --date 2026-04-01
npm run run-daily
npm run install-launchd
npm run uninstall-launchd
```

## 环境变量

```bash
export DEEPSEEK_API_KEY=your_deepseek_key
export SMTP_HOST=smtp.example.com
export SMTP_PORT=465
export SMTP_USER=your_user
export SMTP_PASS=your_password
export MAIL_TO=your@email.com
```

## 首次使用

1. 编辑 `wenlv.config.json` 中的 `email.from`，必要时调整 `browserProfilePath`。
2. 运行 `npm run bootstrap`，首次建议保持有界面模式，完成微信登录或确认浏览器持久化目录可用。
3. 运行 `npm run check` 检查能否抓到新文章。
4. 运行 `npm run report -- --date YYYY-MM-DD --send-email` 生成并发送指定日期日报。
5. 运行 `npm run run-daily` 持续驻留，在每天 `19:00` 自动执行。

## 云端模式（第二阶段）

如果你希望“电脑关机后也能自动发”，不要再依赖本机 `launchd`。第二阶段的推荐做法是：

1. 给每个 `source` 配置 `rssFeedUrls`
2. 把仓库推到 GitHub
3. 在仓库 Secrets 里配置：
   - `DEEPSEEK_API_KEY`
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `MAIL_TO`
4. 启用 [daily-digest.yml](/Users/nafyoung/Documents/Codex%20Project/文旅新闻总结/.github/workflows/daily-digest.yml)

说明：

- 云端模式仍然使用 Playwright 打开真实微信文章页抓正文，但不再依赖搜狗 GUI 搜索和本机登录态。
- GitHub Actions 工作流会在每天北京时间 `19:00` 运行一次，对应 UTC `11:00`。
- GitHub Actions 现在以严格模式运行，只要文章发现源异常，工作流就会标红，避免把抓取失败误判成“当天无新文章”。
- GitHub Actions 现在还会强制使用 `rss-only` 发现模式，不再回退到搜狗搜索，避免 headless 环境下的搜狗反爬噪音。
- 工作流会把 `data/state.json` 和 `reports/*.md` 提交回仓库，确保“已处理文章”状态能跨天持久化。
- 如果不持久化状态，第二天运行会把同一批旧文章再次算作新文章。

`rssFeedUrls` 是第二阶段的关键配置。当前代码支持任意 RSS/Atom 订阅源，只要 feed 里的条目链接最终指向真实公众号文章页即可。

注意：

- 如果同时配置了 `rssFeedUrls` 和 `searchQuery`，程序会先试订阅源，失败后再回退到搜狗搜索。
- 如果使用 `--discovery-mode rss-only`，程序只会使用 `rssFeedUrls`，不会回退到搜狗。
- 公共 RSSHub 实例可作为起点，但稳定性不保证。要做长期无人值守，最好改成你自己的 RSSHub 实例或你确认稳定的第三方实例。

## macOS 自动化

项目提供了 `launchd` 安装脚本，会在当前用户下创建 `com.nafyoung.wenlv-news-digest` 定时任务，每天北京时间 `19:00` 自动执行一次日报流程。

注意：

- 自动化任务会以 `headed` 模式短暂拉起浏览器窗口，以降低搜狗微信搜索反爬概率。
- 执行时需要当前 macOS 用户处于已登录桌面会话；如果完全退出登录，GUI 浏览器无法正常启动。

1. 先把环境变量写到 `~/.config/wenlv-news-digest.env`
2. 再运行：

```bash
npm run install-launchd
```

卸载：

```bash
npm run uninstall-launchd
```

日志默认写到：

- `logs/launchd.stdout.log`
- `logs/launchd.stderr.log`

## 目录说明

- `src/`：命令行、抓取、摘要、日报和邮件逻辑。
- `data/state.json`：运行态，保存已处理文章、失败记录和日报发送状态。
- `reports/YYYY-MM-DD.md`：日报归档。
- `wenlv.config.json`：项目配置。
- `wenlv.launchd.env.example`：`launchd` 使用的环境变量模板。

## 配置示例

`wenlv.config.example.json` 现在同时展示了两类发现方式：

- `searchQuery`：本机模式，走搜狗搜索
- `rssFeedUrls`：云端模式，走 RSS/Atom 订阅源

如果同时配置了 `rssFeedUrls`，程序会优先使用订阅源发现文章。
