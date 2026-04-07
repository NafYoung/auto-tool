import cron from "node-cron";
import { DateTime } from "luxon";
import {
  DEFAULT_CONFIG_PATH,
  loadConfig,
  resolveDeepSeekRuntime,
  resolveEmailRuntime,
} from "./config.js";
import { summarizeArticle, summarizeOverview } from "./deepseek.js";
import { getCurrentReportDate, toCronExpression } from "./digest.js";
import { sendDigestEmail } from "./email.js";
import { renderDailyReportMarkdown, saveReportMarkdown } from "./report.js";
import {
  getArticlesForReportDate,
  getFailuresForReportDate,
  loadState,
  saveReportMetadata,
  saveState,
} from "./state.js";
import { bootstrapSources, checkSources } from "./wechat.js";
import type {
  AppConfig,
  AppState,
  DiscoveryMode,
  ReportFailure,
  StoredArticle,
  StoredReport,
} from "./types.js";

function pickConfigPath(configPath?: string): string {
  return configPath ?? DEFAULT_CONFIG_PATH;
}

function normalizeDiscoveryMode(input?: string): DiscoveryMode | undefined {
  if (!input) {
    return undefined;
  }

  if (input === "hybrid" || input === "rss-only" || input === "search-only") {
    return input;
  }

  throw new Error(`discoveryMode 非法: ${input}。可选值: hybrid, rss-only, search-only`);
}

export function ensureNoSourceFailures(
  failures: ReportFailure[],
  strictFailures = false,
): void {
  if (!strictFailures || failures.length === 0) {
    return;
  }

  const sourceNames = [...new Set(failures.map((failure) => failure.sourceName))];
  throw new Error(
    `本次抓取存在 ${failures.length} 个来源异常，已中止日报发送：${sourceNames.join("、")}`,
  );
}

async function ensureArticleSummaries(
  config: AppConfig,
  state: AppState,
  articles: StoredArticle[],
): Promise<void> {
  const runtime = resolveDeepSeekRuntime(config);

  for (const article of articles) {
    if (article.summaryStatus === "completed" && article.summaryBullets?.length) {
      continue;
    }

    try {
      article.summaryBullets = await summarizeArticle(runtime, article);
      article.summaryStatus = "completed";
      delete article.summaryError;
    } catch (error) {
      article.summaryStatus = "failed";
      article.summaryError = error instanceof Error ? error.message : String(error);
    }

    state.articles[article.normalizedUrl] = article;
  }
}

async function buildOverview(config: AppConfig, reportDate: string, articles: StoredArticle[]) {
  const completed = articles.filter(
    (article) => article.summaryStatus === "completed" && article.summaryBullets?.length,
  );

  if (completed.length === 0) {
    return "今天有新文章，但摘要均未成功生成。日报保留了原文链接和摘录，便于后续人工补看。";
  }

  try {
    return await summarizeOverview(resolveDeepSeekRuntime(config), reportDate, completed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `总览生成失败，已回退为逐篇摘要展示。错误信息：${message}`;
  }
}

export async function runBootstrap(configPath?: string, headless = false): Promise<void> {
  const config = await loadConfig(pickConfigPath(configPath));
  const state = await loadState(config.dataDir);
  const bootstrapped = await bootstrapSources(config, state, { headless });
  await saveState(config.dataDir, state);

  console.log(`bootstrap 完成，共处理 ${bootstrapped.length} 个公众号。`);
  for (const item of bootstrapped) {
    console.log(`- ${item.accountName ?? "未知公众号"} -> ${item.derivedProfileUrl ?? "未推导出主页链接"}`);
  }
}

export async function runCheck(
  configPath?: string,
  headless = true,
  discoveryMode?: string,
) {
  const config = await loadConfig(pickConfigPath(configPath));
  const state = await loadState(config.dataDir);
  const result = await checkSources(config, state, {
    headless,
    discoveryMode: normalizeDiscoveryMode(discoveryMode),
  });
  await saveState(config.dataDir, state);

  console.log(`check 完成，新增文章 ${result.newArticles.length} 篇，异常 ${result.failures.length} 个。`);
  for (const article of result.newArticles) {
    console.log(`- [${article.sourceName}] ${article.title}`);
  }

  for (const failure of result.failures) {
    console.log(`- [异常] ${failure.sourceName}: ${failure.message}`);
  }

  return result;
}

export async function runReport(
  options: {
    configPath?: string;
    reportDate?: string;
    sendEmail?: boolean;
    force?: boolean;
  } = {},
) {
  const config = await loadConfig(pickConfigPath(options.configPath));
  const state = await loadState(config.dataDir);
  const reportDate = options.reportDate ?? getCurrentReportDate(config.schedule);
  const alreadySent = state.reports[reportDate]?.emailedAt;

  if (alreadySent && options.sendEmail && !options.force) {
    console.log(`日报 ${reportDate} 已发送，如需重发请使用 --force。`);
    return state.reports[reportDate];
  }

  const articles = getArticlesForReportDate(state, reportDate);
  const failures = getFailuresForReportDate(state, reportDate);

  if (articles.length === 0) {
    const skippedReport: StoredReport = {
      date: reportDate,
      generatedAt: new Date().toISOString(),
      articleUrls: [],
      failureCount: failures.length,
      skipped: true,
    };
    saveReportMetadata(state, skippedReport);
    await saveState(config.dataDir, state);
    console.log(`日报 ${reportDate} 无新文章，已记录跳过结果。`);
    return skippedReport;
  }

  await ensureArticleSummaries(config, state, articles);
  const overview = await buildOverview(config, reportDate, articles);
  const markdown = renderDailyReportMarkdown({
    config,
    reportDate,
    articles,
    overview,
    failures,
  });
  const markdownPath = await saveReportMarkdown(config.reportDir, reportDate, markdown);

  let emailedAt: string | undefined;
  if (options.sendEmail) {
    await sendDigestEmail(resolveEmailRuntime(config), reportDate, markdown);
    emailedAt = new Date().toISOString();
  }

  const report: StoredReport = {
    date: reportDate,
    generatedAt: new Date().toISOString(),
    articleUrls: articles.map((article) => article.url),
    failureCount: failures.length,
    skipped: false,
    ...(emailedAt ? { emailedAt } : {}),
    ...(markdownPath ? { markdownPath } : {}),
    ...(overview ? { overview } : {}),
  };

  saveReportMetadata(state, report);
  await saveState(config.dataDir, state);

  console.log(`日报已生成: ${markdownPath}`);
  if (emailedAt) {
    console.log(`日报已发送到 ${config.email.to ?? process.env.MAIL_TO ?? "配置中的收件人"}`);
  }

  return report;
}

export async function runDaily(options: {
  configPath?: string;
  headless?: boolean;
  strictFailures?: boolean;
  discoveryMode?: string;
  once?: boolean;
  reportDate?: string;
} = {}) {
  const configPath = pickConfigPath(options.configPath);
  const config = await loadConfig(configPath);
  const headless = options.headless ?? true;

  const executeOnce = async () => {
    const checkResult = await runCheck(configPath, headless, options.discoveryMode);
    ensureNoSourceFailures(checkResult.failures, options.strictFailures ?? false);
    await runReport({
      configPath,
      reportDate: options.reportDate ?? getCurrentReportDate(config.schedule),
      sendEmail: true,
    });
  };

  if (options.once) {
    await executeOnce();
    return;
  }

  const cronExpression = toCronExpression(config.schedule);
  let running = false;

  console.log(
    `已启动日报调度，时区 ${config.schedule.timezone}，每天 ${config.schedule.dailyReportTime} 执行。`,
  );

  cron.schedule(
    cronExpression,
    async () => {
      if (running) {
        console.log("上一次日报任务仍在执行，跳过本轮调度。");
        return;
      }

      running = true;
      try {
        console.log(`开始执行日报任务: ${DateTime.now().setZone(config.schedule.timezone).toISO()}`);
        await executeOnce();
      } catch (error) {
        console.error(error);
      } finally {
        running = false;
      }
    },
    { timezone: config.schedule.timezone },
  );

  await new Promise(() => undefined);
}
