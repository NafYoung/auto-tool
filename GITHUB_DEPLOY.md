# GitHub 上线步骤

这个项目现在已经是独立 git 仓库，可以直接单独推到 GitHub。

## 1. 创建 GitHub 仓库

推荐仓库名：

- `wenlv-news-digest`

要求：

- 创建空仓库
- 不要勾选 `README`
- 不要勾选 `.gitignore`
- 不要勾选 license

如果你想用命令行，先登录：

```bash
gh auth login
```

然后创建仓库：

```bash
gh repo create wenlv-news-digest --private --source=. --remote=origin --push
```

如果你想用网页：

1. 在 GitHub 新建一个空仓库 `wenlv-news-digest`
2. 然后在本地执行：

```bash
git add .
git commit -m "feat: initial wechat digest project"
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

例如：

```bash
git remote add origin git@github.com:<你的用户名>/wenlv-news-digest.git
git push -u origin main
```

或：

```bash
git remote add origin https://github.com/<你的用户名>/wenlv-news-digest.git
git push -u origin main
```

## 2. 配置 GitHub Actions Secrets

进入仓库：

- `Settings`
- `Secrets and variables`
- `Actions`

添加这些 secrets：

- `DEEPSEEK_API_KEY`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_TO`

## 3. 确认配置文件

当前 [wenlv.config.json](/Users/nafyoung/Documents/Codex%20Project/文旅新闻总结/wenlv.config.json) 已经补了两个公众号的 `rssFeedUrls`：

- `https://rsshub.app/wechat/uread/DCTA2024`
- `https://rsshub.app/wechat/uread/sh_act`

如果你后面改成自己的 RSSHub 实例，只需要把这两个 URL 的域名替换掉即可。

## 4. 启用并测试工作流

工作流文件在：

- [.github/workflows/daily-digest.yml](/Users/nafyoung/Documents/Codex%20Project/文旅新闻总结/.github/workflows/daily-digest.yml)

它会在每天北京时间 `19:00` 运行。
现在工作流会以严格模式运行：只要抓取来源异常，任务就会直接失败并标红，避免把失败误记成“无新文章”。
现在工作流还会强制使用 `rss-only` 发现模式：只走 `rssFeedUrls`，不再回退到搜狗搜索。

第一次建议手动触发：

1. 打开 GitHub 仓库
2. 进入 `Actions`
3. 选择 `Daily Digest`
4. 点击 `Run workflow`

## 5. 你应该看到的结果

第一次成功后，仓库里会自动更新：

- `data/state.json`
- `reports/YYYY-MM-DD.md`

如果当天有新文章，会发邮件到 `MAIL_TO`。
如果当天没有新文章，工作流会成功结束，但不会发空邮件。
如果抓取来源异常，工作流会失败，你需要查看 `Run daily digest once` 的日志。

## 6. 常见问题

### 6.1 工作流跑了但没发邮件

先看两件事：

- 是否真的抓到了“当天发现的新文章”
- Actions 日志里是否出现 SMTP 报错

### 6.2 公共 RSSHub 实例超时

这是第二阶段最常见的不稳定点。

处理顺序：

1. 先手动触发一次，确认是否只是临时超时
2. 如果长期超时，把 `rsshub.app` 换成你自己的 RSSHub 实例
3. GitHub Actions 现在不会再回退到搜狗搜索；如果 feed 长期不稳定，就换成你自己的 RSSHub 实例或稳定第三方 feed

### 6.3 为什么需要把 `data/state.json` 提交回仓库

因为不持久化状态的话，下一次运行时程序不知道哪些文章已经处理过，会重复发送旧文章。
