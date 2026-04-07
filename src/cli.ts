#!/usr/bin/env node

import { Command } from "commander";
import { DEFAULT_CONFIG_PATH } from "./config.js";
import { runBootstrap, runCheck, runDaily, runReport } from "./workflow.js";

const program = new Command();

program
  .name("wenlv-digest")
  .description("监控指定公众号并生成文旅日报")
  .version("0.1.0");

program
  .command("bootstrap")
  .description("打开种子文章，推导公众号主页链接并保存到状态文件")
  .option("-c, --config <path>", "配置文件路径", DEFAULT_CONFIG_PATH)
  .option("--headless", "无界面启动浏览器", false)
  .action(async (options) => {
    await runBootstrap(options.config, options.headless);
  });

program
  .command("check")
  .description("检查公众号是否有新文章，并写入本地状态")
  .option("-c, --config <path>", "配置文件路径", DEFAULT_CONFIG_PATH)
  .option("--headed", "有界面启动浏览器，便于排查登录态", false)
  .option("--discovery-mode <mode>", "文章发现模式: hybrid, rss-only, search-only")
  .action(async (options) => {
    await runCheck(options.config, !options.headed, options.discoveryMode);
  });

program
  .command("report")
  .description("为指定日期生成 Markdown 日报")
  .option("-c, --config <path>", "配置文件路径", DEFAULT_CONFIG_PATH)
  .option("--date <date>", "日报日期，格式 YYYY-MM-DD")
  .option("--send-email", "生成后同时发邮件", false)
  .option("--force", "即使当天已发过，也重新发送", false)
  .action(async (options) => {
    await runReport({
      configPath: options.config,
      reportDate: options.date,
      sendEmail: options.sendEmail,
      force: options.force,
    });
  });

program
  .command("run-daily")
  .description("启动每日 19:00 的本地调度任务")
  .option("-c, --config <path>", "配置文件路径", DEFAULT_CONFIG_PATH)
  .option("--headed", "有界面启动浏览器，便于调试登录态", false)
  .option("--strict-failures", "当抓取异常时以失败状态退出，便于自动化告警", false)
  .option("--discovery-mode <mode>", "文章发现模式: hybrid, rss-only, search-only")
  .option("--once", "立刻执行一次检测与日报流程，然后退出", false)
  .option("--date <date>", "仅在 --once 时有效，指定生成哪一天的日报")
  .action(async (options) => {
    await runDaily({
      configPath: options.config,
      headless: !options.headed,
      strictFailures: options.strictFailures,
      discoveryMode: options.discoveryMode,
      once: options.once,
      reportDate: options.date,
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
