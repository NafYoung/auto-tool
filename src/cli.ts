#!/usr/bin/env node

import { Command } from "commander";
import { LOCAL_CONFIG_PATH, PUBLIC_CONFIG_PATH } from "./config.js";
import { runBootstrap, runCheck, runDaily, runReport, runSyncFeeds } from "./workflow.js";

const program = new Command();
const configHelpText = `配置文件路径（默认按 ${LOCAL_CONFIG_PATH} -> ${PUBLIC_CONFIG_PATH} 查找）`;

program
  .name("wenlv-digest")
  .description("监控指定公众号并生成文旅日报")
  .version("0.1.0");

program
  .command("bootstrap")
  .description("打开种子文章，推导公众号主页链接并保存到状态文件")
  .option("-c, --config <path>", configHelpText)
  .option("--headless", "无界面启动浏览器", false)
  .action(async (options) => {
    await runBootstrap(options.config, options.headless);
  });

program
  .command("check")
  .description("检查公众号是否有新文章，并写入本地状态")
  .option("-c, --config <path>", configHelpText)
  .option("--headed", "有界面启动浏览器，便于排查登录态", false)
  .option("--discovery-mode <mode>", "文章发现模式: hybrid, rss-only, search-only")
  .action(async (options) => {
    await runCheck(options.config, !options.headed, options.discoveryMode);
  });

program
  .command("report")
  .description("为指定日期生成 Markdown 日报")
  .option("-c, --config <path>", configHelpText)
  .option("--date <date>", "日报日期，格式 YYYY-MM-DD")
  .option("--send-email", "生成后同时发邮件", false)
  .option("--mark-as-sent", "将本次手动发送记为当天正式发送", false)
  .option("--force", "即使当天已发过，也重新发送", false)
  .action(async (options) => {
    await runReport({
      configPath: options.config,
      reportDate: options.date,
      sendEmail: options.sendEmail,
      markAsSent: options.markAsSent,
      force: options.force,
    });
  });

program
  .command("sync-feeds")
  .description("用 Wechat2RSS 根据 seedArticleUrl 同步 rssFeedUrls 到配置文件")
  .option("-c, --config <path>", configHelpText)
  .option("--dry-run", "只预览 feed 结果，不写回配置文件", false)
  .action(async (options) => {
    await runSyncFeeds({
      configPath: options.config,
      dryRun: options.dryRun,
    });
  });

program
  .command("run-daily")
  .description("启动每日本机兜底调度任务")
  .option("-c, --config <path>", configHelpText)
  .option("--headed", "有界面启动浏览器，便于调试登录态", false)
  .option("--strict-failures", "当抓取异常时以失败状态退出，便于自动化告警", false)
  .option("--discovery-mode <mode>", "文章发现模式: hybrid, rss-only, search-only")
  .option("--delivery-origin <origin>", "发送来源标记: cloud, local", "local")
  .option("--once", "立刻执行一次检测与日报流程，然后退出", false)
  .option("--date <date>", "仅在 --once 时有效，指定生成哪一天的日报")
  .action(async (options) => {
    await runDaily({
      configPath: options.config,
      headless: !options.headed,
      strictFailures: options.strictFailures,
      discoveryMode: options.discoveryMode,
      deliveryOrigin: options.deliveryOrigin,
      once: options.once,
      reportDate: options.date,
    });
  });

program
  .command("serve")
  .description("启动 HTTP API 服务（供 Claude Code Skill 调用）")
  .option("-c, --config <path>", configHelpText)
  .option("-p, --port <port>", "监听端口", "3457")
  .action(async (options) => {
    const { startServer } = await import("./server.js");
    await startServer({
      port: Number(options.port),
      configPath: options.config,
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
