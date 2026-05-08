import cron from "node-cron";
import { DateTime } from "luxon";
import {
  DEFAULT_CONFIG_PATH,
  loadConfig,
  resolveDefaultConfigPath,
  resolveDeepSeekRuntime,
  resolveEmailRuntime,
  resolveWechat2RssRuntime,
} from "./config.js";
import { summarizeArticle, summarizeOverview } from "./deepseek.js";
import {
  getCurrentReportDate,
  getLatestDueReportDate,
  isTimestampFreshForReport,
  toCronExpression,
} from "./digest.js";
import { sendDigestEmail } from "./email.js";
import { renderDailyReportMarkdown, saveReportMarkdown } from "./report.js";
import { syncWechat2RssFeeds } from "./wechat2rss.js";
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
  DeliveryOrigin,
  DiscoveryMode,
  ReportFailure,
  StoredArticle,
  StoredReport,
} from "./types.js";

function pickConfigPath(configPath?: string): string {
  return configPath ?? resolveDefaultConfigPath();
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

function normalizeDeliveryOrigin(input?: string): DeliveryOrigin | undefined {
  if (!input) {
    return undefined;
  }

  if (input === "cloud" || input === "local") {
    return input;
  }

  throw new Error(`deliveryOrigin 非法: ${input}。可选值: cloud, local`);
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

export function shouldSkipEmailBecauseAlreadyMarked(args: {
  alreadySent?: string;
  sendEmail?: boolean;
  force?: boolean;
  markAsSent?: boolean;
}): boolean {
  return Boolean(args.alreadySent && args.sendEmail && args.markAsSent && !args.force);
}

export function shouldSkipLocalFallback(args: {
  existingReport?: StoredReport;
  deliveryOrigin?: DeliveryOrigin;
}): boolean {
  if (args.deliveryOrigin !== "local" || !args.existingReport?.emailedAt) {
    return false;
  }

  const existingArticleCount =
    args.existingReport.articleKeys?.length ?? args.existingReport.articleUrls.length;

  if (args.existingReport.deliveryOrigin === "cloud" && existingArticleCount === 0) {
    return false;
  }

  return true;
}

export function shouldDeferEmptyCloudReportToLocalFallback(args: {
  deliveryOrigin?: DeliveryOrigin;
  articleCount: number;
}): boolean {
  return args.deliveryOrigin === "cloud" && args.articleCount === 0;
}

export function resolvePersistedEmailedAt(args: {
  existingEmailedAt?: string;
  sendEmail?: boolean;
  markAsSent?: boolean;
  sentAt?: string;
}): string | undefined {
  if (args.sendEmail && args.markAsSent && args.sentAt) {
    return args.sentAt;
  }

  return args.existingEmailedAt;
}

export function resolvePersistedDeliveryOrigin(args: {
  existingDeliveryOrigin?: DeliveryOrigin;
  sendEmail?: boolean;
  markAsSent?: boolean;
  deliveryOrigin?: DeliveryOrigin;
}): DeliveryOrigin | undefined {
  if (args.sendEmail && args.markAsSent && args.deliveryOrigin) {
    return args.deliveryOrigin;
  }

  return args.existingDeliveryOrigin;
}

export function hasReportArticleDelta(
  existingReport: StoredReport | undefined,
  articles: StoredArticle[],
): boolean {
  if (!existingReport) {
    return articles.length > 0;
  }

  const existingKeys = new Set(
    existingReport.articleKeys?.length
      ? existingReport.articleKeys
      : existingReport.articleUrls,
  );

  return articles.some((article) => !existingKeys.has(article.normalizedUrl));
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

function buildEmptyStatusOverview(failures: ReportFailure[]): string {
  if (failures.length > 0) {
    return "今天没有发现符合条件的新文章；下方保留了抓取异常，便于确认系统已运行并排查内容源。";
  }

  return "今天没有发现符合条件的新文章。";
}

function filterFreshArticlesForReport(
  config: AppConfig,
  reportDate: string,
  articles: StoredArticle[],
): StoredArticle[] {
  return articles.filter((article) => {
    const source = config.sources.find((item) => item.id === article.sourceId);
    const maxAgeDays = source?.maxArticleAgeDays ?? 2;
    return isTimestampFreshForReport(article.publishedAt, reportDate, config.schedule, maxAgeDays);
  });
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

export async function runSyncFeeds(
  options: {
    configPath?: string;
    dryRun?: boolean;
  } = {},
): Promise<void> {
  const configPath = pickConfigPath(options.configPath);
  const results = await syncWechat2RssFeeds(
    configPath,
    resolveWechat2RssRuntime(),
    { dryRun: options.dryRun },
  );

  console.log(
    `${options.dryRun ? "预览" : "同步"}完成，共处理 ${results.length} 个公众号的 rssFeedUrls。`,
  );
  for (const result of results) {
    console.log(`- [${result.accountName}] ${result.feedUrl}`);
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
    markAsSent?: boolean;
    deliveryOrigin?: DeliveryOrigin;
  } = {},
) {
  const config = await loadConfig(pickConfigPath(options.configPath));
  const state = await loadState(config.dataDir);
  const reportDate = options.reportDate ?? getCurrentReportDate(config.schedule);
  const existingReport = state.reports[reportDate];
  const alreadySent = existingReport?.emailedAt;

  const articles = filterFreshArticlesForReport(
    config,
    reportDate,
    getArticlesForReportDate(state, reportDate),
  );
  const failures = getFailuresForReportDate(state, reportDate);

  const hasArticleDelta = hasReportArticleDelta(existingReport, articles);

  if (
    shouldSkipEmailBecauseAlreadyMarked({
      alreadySent,
      sendEmail: options.sendEmail,
      force: options.force,
      markAsSent: options.markAsSent,
    }) &&
    !hasArticleDelta
  ) {
    console.log(`日报 ${reportDate} 已发送，如需重发请使用 --force。`);
    return existingReport;
  }

  if (articles.length > 0) {
    await ensureArticleSummaries(config, state, articles);
  }

  const overview =
    articles.length > 0
      ? await buildOverview(config, reportDate, articles)
      : buildEmptyStatusOverview(failures);
  const markdown = renderDailyReportMarkdown({
    config,
    reportDate,
    articles,
    overview,
    failures,
  });
  const markdownPath = await saveReportMarkdown(config.reportDir, reportDate, markdown);

  if (
    alreadySent &&
    options.sendEmail &&
    options.markAsSent &&
    !options.force &&
    hasArticleDelta
  ) {
    const addedCount = articles.filter((article) => {
      const existingKeys = new Set(
        existingReport?.articleKeys?.length
          ? existingReport.articleKeys
          : existingReport?.articleUrls ?? [],
      );
      return !existingKeys.has(article.normalizedUrl);
    }).length;
    console.log(`日报 ${reportDate} 已发送，但检测到 ${addedCount} 篇晚到新文章，执行补发。`);
  }

  let sentAt: string | undefined;
  if (options.sendEmail) {
    await sendDigestEmail(resolveEmailRuntime(config), reportDate, markdown);
    sentAt = new Date().toISOString();
  }

  const emailedAt = resolvePersistedEmailedAt({
    existingEmailedAt: alreadySent,
    sendEmail: options.sendEmail,
    markAsSent: options.markAsSent,
    sentAt,
  });
  const deliveryOrigin = resolvePersistedDeliveryOrigin({
    existingDeliveryOrigin: existingReport?.deliveryOrigin,
    sendEmail: options.sendEmail,
    markAsSent: options.markAsSent,
    deliveryOrigin: options.deliveryOrigin,
  });

  const report: StoredReport = {
    date: reportDate,
    generatedAt: new Date().toISOString(),
    articleUrls: articles.map((article) => article.url),
    articleKeys: articles.map((article) => article.normalizedUrl),
    failureCount: failures.length,
    skipped: false,
    ...(emailedAt ? { emailedAt } : {}),
    ...(markdownPath ? { markdownPath } : {}),
    ...(overview ? { overview } : {}),
    ...(deliveryOrigin ? { deliveryOrigin } : {}),
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
  deliveryOrigin?: string;
} = {}) {
  const configPath = pickConfigPath(options.configPath);
  const config = await loadConfig(configPath);
  const headless = options.headless ?? true;
  const deliveryOrigin = normalizeDeliveryOrigin(options.deliveryOrigin) ?? "local";

  const executeOnce = async () => {
    const dueReportDate = options.reportDate ?? getLatestDueReportDate(config.schedule);
    const state = await loadState(config.dataDir);
    const existingReport = state.reports[dueReportDate];

    if (shouldSkipLocalFallback({ existingReport, deliveryOrigin })) {
      console.log(
        `日报 ${dueReportDate} 已由 ${existingReport?.deliveryOrigin ?? "其他链路"}发送，本机兜底跳过。`,
      );
      return existingReport;
    }

    const checkResult = await runCheck(configPath, headless, options.discoveryMode);
    ensureNoSourceFailures(checkResult.failures, options.strictFailures ?? false);

    const checkedState = await loadState(config.dataDir);
    const articles = filterFreshArticlesForReport(
      config,
      dueReportDate,
      getArticlesForReportDate(checkedState, dueReportDate),
    );

    if (
      shouldDeferEmptyCloudReportToLocalFallback({
        deliveryOrigin,
        articleCount: articles.length,
      })
    ) {
      console.log("云端未发现新文章，暂不发送正式空日报，等待本机兜底复核。");
      return runReport({
        configPath,
        reportDate: dueReportDate,
        sendEmail: false,
        markAsSent: false,
        deliveryOrigin,
      });
    }

    return runReport({
      configPath,
      reportDate: dueReportDate,
      sendEmail: true,
      markAsSent: true,
      deliveryOrigin,
    });
  };

  if (options.once) {
    await executeOnce();
    return;
  }

  const cronExpression = toCronExpression(config.schedule);
  let running = false;

  console.log(
    `已启动日报调度，时区 ${config.schedule.timezone}，每天 ${config.schedule.localFallbackSendTime} 执行本机兜底。`,
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
