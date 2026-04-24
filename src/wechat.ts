import { DateTime } from "luxon";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { BrowserContext, Page } from "playwright";

chromium.use(StealthPlugin());
import {
  buildContentHash,
  buildExcerpt,
  cleanArticleContent,
  normalizeWeChatUrl,
  parseWeChatPublishedAt,
} from "./pipeline.js";
import { getReportDateForLateAwareDiscovery, getReportDateForTimestamp, isTimestampFreshForReport } from "./digest.js";
import {
  addFailureForReportDate,
  ensureSourceState,
  rememberProcessedUrl,
  saveBootstrapMetadata,
  upsertArticle,
} from "./state.js";
import { fetchFeedCandidates } from "./feed.js";
import type {
  AppConfig,
  AppState,
  ArticleCandidate,
  DiscoveryMode,
  FetchedArticle,
  ReportFailure,
  SourceBootstrapMetadata,
  StoredArticle,
  WeChatSourceConfig,
} from "./types.js";

const WECHAT_ARTICLE_BLOCK_MARKERS = ["环境异常", "访问过于频繁"];
const SOGOU_ANTISPIDER_MARKERS = [
  "请输入验证码",
  "访问过于频繁",
  "antispider",
  "此验证码用于确认这些请求是您的正常行为而不是自动程序发出的",
  "请依次点击【",
];
const SOGOU_SEARCH_URL = "https://weixin.sogou.com/weixin?type=2&query=";
const SOGOU_MAX_PAGES = 4;

interface SearchResultRow {
  account?: string;
  publishedAtHint?: string;
  titleHint?: string;
  url?: string;
}

function resolveDiscoveryMethods(
  source: WeChatSourceConfig,
  discoveryMode: DiscoveryMode,
): Array<"feed" | "sogou"> {
  const methods: Array<"feed" | "sogou"> = [];

  if (discoveryMode !== "search-only" && source.rssFeedUrls?.length) {
    methods.push("feed");
  }

  if (discoveryMode !== "rss-only") {
    methods.push("sogou");
  }

  return methods;
}

function buildArticleTextSelectors(source: WeChatSourceConfig): string[] {
  return [
    source.selectors.articleTitle ?? "",
    "#activity-name",
    "h1.rich_media_title",
    "meta[property='og:title']",
    "title",
  ].filter(Boolean);
}

function buildAccountSelectors(source: WeChatSourceConfig): string[] {
  return [
    source.selectors.accountName ?? "",
    "#js_name",
    ".profile_nickname",
    ".account_nickname_inner",
    "meta[name='author']",
  ].filter(Boolean);
}

function buildContentSelectors(source: WeChatSourceConfig): string[] {
  return [
    source.selectors.articleContent ?? "",
    "#js_content",
    ".rich_media_content",
    "article",
  ].filter(Boolean);
}

function buildPublishTimeSelectors(source: WeChatSourceConfig): string[] {
  return [
    source.selectors.publishTime ?? "",
    "#publish_time",
    "#js_publish_time",
    "meta[property='article:published_time']",
    "meta[name='publish_time']",
  ].filter(Boolean);
}

function buildProfileLinkSelectors(source: WeChatSourceConfig): string[] {
  return [
    source.selectors.profileLink ?? "",
    "a[href*='profile_ext?action=home']",
    "a[href*='/mp/profile_ext']",
  ].filter(Boolean);
}

async function extractText(page: Page, selectors: string[]): Promise<string | undefined> {
  return page.evaluate((selectorList) => {
    for (const selector of selectorList) {
      const node = document.querySelector(selector);
      if (!node) {
        continue;
      }

      if (node instanceof HTMLMetaElement) {
        const content = node.content.trim();
        if (content) {
          return content;
        }
      }

      const text = node.textContent?.replace(/\s+/g, " ").trim();
      if (text) {
        return text;
      }
    }

    return undefined;
  }, selectors);
}

async function extractLargeText(page: Page, selectors: string[]): Promise<string | undefined> {
  return page.evaluate((selectorList) => {
    for (const selector of selectorList) {
      const node = document.querySelector(selector);
      if (!node) {
        continue;
      }

      const text =
        (node as HTMLElement).innerText?.replace(/\u00a0/g, " ").trim() ??
        node.textContent?.replace(/\u00a0/g, " ").trim();

      if (text) {
        return text;
      }
    }

    return undefined;
  }, selectors);
}

async function extractLink(page: Page, selectors: string[]): Promise<string | undefined> {
  return page.evaluate((selectorList) => {
    for (const selector of selectorList) {
      const node = document.querySelector(selector);
      if (!node || !(node instanceof HTMLAnchorElement)) {
        continue;
      }

      const href = node.href?.trim();
      if (href) {
        return href;
      }
    }

    return undefined;
  }, selectors);
}

function extractBizId(url: string, html: string): string | undefined {
  const urlMatch = url.match(/[?&]__biz=([^&#]+)/);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  const htmlMatch =
    html.match(/var\s+biz\s*=\s*"([^"]+)"/) ??
    html.match(/"__biz"\s*:\s*"([^"]+)"/) ??
    html.match(/profile_ext\?action=home&amp;__biz=([^"&]+)/);

  return htmlMatch?.[1];
}

function extractArticleIdentity(html: string): {
  biz?: string;
  mid?: string;
  idx?: string;
  sn?: string;
} {
  const readVar = (name: string) =>
    html.match(new RegExp(`var\\s+${name}\\s*=\\s*"([^"]*)"`))?.[1] ||
    html.match(new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`))?.[1];

  return compactOptional({
    biz: readVar("biz"),
    mid: readVar("mid"),
    idx: readVar("idx"),
    sn: readVar("sn"),
  });
}

function buildCanonicalArticleUrl(pageUrl: string, html: string): string {
  const identity = extractArticleIdentity(html);
  if (!identity.biz || !identity.mid || !identity.idx) {
    return pageUrl;
  }

  const params = new URLSearchParams({
    __biz: identity.biz,
    mid: identity.mid,
    idx: identity.idx,
  });

  if (identity.sn) {
    params.set("sn", identity.sn);
  }

  return `https://mp.weixin.qq.com/s?${params.toString()}`;
}

function buildStoredArticleUrls(pageUrl: string, html: string): {
  url: string;
  normalizedUrl: string;
} {
  const canonicalUrl = buildCanonicalArticleUrl(pageUrl, html);
  const normalizedUrl = normalizeWeChatUrl(canonicalUrl);
  const identity = extractArticleIdentity(html);
  const hasStableSn = Boolean(identity.sn?.trim());
  const hasSignedWechatUrl =
    pageUrl.startsWith("https://mp.weixin.qq.com/s?") &&
    (pageUrl.includes("signature=") ||
      pageUrl.includes("timestamp=") ||
      pageUrl.includes("poc_token="));

  return {
    url: hasStableSn || !hasSignedWechatUrl ? canonicalUrl : normalizeWeChatUrl(pageUrl),
    normalizedUrl,
  };
}

function normalizeProfileUrl(rawUrl: string, pageUrl: string): string {
  const decoded = rawUrl.replace(/&amp;/g, "&");

  if (decoded.startsWith("//")) {
    return `https:${decoded}`;
  }

  return new URL(decoded, pageUrl).toString();
}

function getBizIdFromProfileUrl(profileUrl: string): string | undefined {
  try {
    const url = new URL(profileUrl);
    const bizId = url.searchParams.get("__biz")?.trim();
    return bizId || undefined;
  } catch {
    return undefined;
  }
}

function buildProfileUrlFromBizId(bizId: string): string {
  return `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(bizId)}#wechat_redirect`;
}

function sanitizeDerivedProfileUrl(
  candidateUrl: string | undefined,
  bizId?: string,
): string | undefined {
  if (!candidateUrl) {
    return bizId ? buildProfileUrlFromBizId(bizId) : undefined;
  }

  const candidateBizId = getBizIdFromProfileUrl(candidateUrl);
  if (candidateBizId) {
    return candidateUrl;
  }

  return bizId ? buildProfileUrlFromBizId(bizId) : undefined;
}

function deriveProfileUrl(
  maybeProfileUrl: string | undefined,
  pageUrl: string,
  html: string,
  bizId?: string,
): string | undefined {
  if (maybeProfileUrl) {
    return sanitizeDerivedProfileUrl(normalizeProfileUrl(maybeProfileUrl, pageUrl), bizId);
  }

  const htmlMatch =
    html.match(/https?:\/\/mp\.weixin\.qq\.com\/mp\/profile_ext\?action=home[^"'\\\s]+/) ??
    html.match(/\/mp\/profile_ext\?action=home[^"'\\\s]+/);

  if (htmlMatch?.[0]) {
    return sanitizeDerivedProfileUrl(normalizeProfileUrl(htmlMatch[0], pageUrl), bizId);
  }

  if (bizId) {
    return buildProfileUrlFromBizId(bizId);
  }

  return undefined;
}

function compactOptional<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

function normalizeLooseText(input: string | undefined): string {
  return (input ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[“”"'`‘’·•:：,，.。!！?？\-_/()（）\[\]【】]/g, "")
    .trim()
    .toLowerCase();
}

function isLikelySameAccount(candidateAccount: string | undefined, expectedAccount: string): boolean {
  const candidate = normalizeLooseText(candidateAccount);
  const expected = normalizeLooseText(expectedAccount);

  if (!candidate || !expected) {
    return false;
  }

  return candidate === expected || candidate.includes(expected) || expected.includes(candidate);
}

function buildSearchQueries(
  source: WeChatSourceConfig,
  now = DateTime.now().setZone("Asia/Shanghai"),
): string[] {
  const currentYear = now.toFormat("yyyy");
  const queries = [
    source.searchQuery,
    source.searchQuery ? `${source.searchQuery} ${currentYear}` : undefined,
    source.accountName,
    `${source.accountName} ${currentYear}`,
    `${source.accountName} 微信`,
    `${source.accountName} 公众号`,
  ].filter((value): value is string => Boolean(value?.trim()));

  return Array.from(new Set(queries.map((value) => value.trim())));
}

function parseSogouResultTimestamp(
  rawMeta: string | undefined,
  now = DateTime.now().setZone("Asia/Shanghai"),
): string | undefined {
  const meta = rawMeta?.replace(/\s+/g, " ").trim();
  if (!meta) {
    return undefined;
  }

  const relativeDayMatch = meta.match(/(\d+)\s*天前/);
  if (relativeDayMatch) {
    const days = Number(relativeDayMatch[1]);
    return now.minus({ days }).toISO() ?? undefined;
  }

  const relativeHourMatch = meta.match(/(\d+)\s*小时前/);
  if (relativeHourMatch) {
    const hours = Number(relativeHourMatch[1]);
    return now.minus({ hours }).toISO() ?? undefined;
  }

  const absoluteDateMatch = meta.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (absoluteDateMatch) {
    const [, year, month, day] = absoluteDateMatch;
    return (
      DateTime.fromObject(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: 12,
        minute: 0,
        second: 0,
        millisecond: 0,
      },
      { zone: now.zoneName ?? "Asia/Shanghai" },
    ).toISO() ?? undefined
    );
  }

  return undefined;
}

function isSearchCandidateFresh(
  candidate: ArticleCandidate,
  reportDate: string,
  config: AppConfig,
  source: WeChatSourceConfig,
): boolean {
  if (!candidate.publishedAtHint) {
    return true;
  }

  const parsed = parseSogouResultTimestamp(
    candidate.publishedAtHint,
    DateTime.fromISO(reportDate, { zone: config.schedule.timezone }).set({
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0,
    }),
  );

  if (!parsed) {
    return true;
  }

  return isTimestampFreshForReport(
    parsed,
    reportDate,
    config.schedule,
    source.maxArticleAgeDays,
  );
}

function sameBizId(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  try {
    return decodeURIComponent(left) === decodeURIComponent(right);
  } catch {
    return left === right;
  }
}

async function assertPageUsable(page: Page): Promise<void> {
  const currentUrl = page.url();
  const title = await page.title();
  const bodyText = (await page.textContent("body")) ?? "";

  if (
    currentUrl.includes("weixin.sogou.com/antispider") ||
    SOGOU_ANTISPIDER_MARKERS.some((marker) => title.includes(marker) || bodyText.includes(marker))
  ) {
    throw new Error("搜狗微信搜索触发反爬，请用 --headed 重试并在弹出的浏览器里完成验证。");
  }

  if (
    bodyText.includes("请在微信客户端打开链接") ||
    WECHAT_ARTICLE_BLOCK_MARKERS.some((marker) => bodyText.includes(marker))
  ) {
    throw new Error("微信页面触发校验或访问限制，请先用 bootstrap 命令在有界面模式下完成登录。");
  }
}

async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(1_200);
  await assertPageUsable(page);
}

async function waitForArticleReady(page: Page, source: WeChatSourceConfig): Promise<void> {
  const titleSelectors = buildArticleTextSelectors(source);
  const publishSelectors = buildPublishTimeSelectors(source);
  const contentSelectors = buildContentSelectors(source);

  await page
    .waitForFunction(
      ({ titleSelectors: titleList, publishSelectors: publishList, contentSelectors: contentList }) => {
        const readText = (selectors: string[]): string | undefined => {
          for (const selector of selectors) {
            const node = document.querySelector(selector);
            if (!node) {
              continue;
            }

            if (node instanceof HTMLMetaElement) {
              const content = node.content.trim();
              if (content) {
                return content;
              }
            }

            const text =
              (node as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ??
              node.textContent?.replace(/\s+/g, " ").trim();

            if (text) {
              return text;
            }
          }

          return undefined;
        };

        const title = readText(titleList);
        const publishTime = readText(publishList);
        const content = readText(contentList);
        return Boolean(title && publishTime && content && content.length >= 20);
      },
      {
        titleSelectors,
        publishSelectors,
        contentSelectors,
      },
      { timeout: 30_000 },
    )
    .catch(() => undefined);
}

export async function withWechatContext<T>(
  config: AppConfig,
  headless: boolean,
  fn: (context: BrowserContext) => Promise<T>,
): Promise<T> {
  const context = await chromium.launchPersistentContext(config.browserProfilePath, {
    headless,
    locale: "zh-CN",
    timezoneId: config.schedule.timezone,
    viewport: { width: 1440, height: 960 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox",
    ],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en"] });
    (window as any).chrome = { runtime: {} };
  });

  try {
    return await fn(context);
  } finally {
    await context.close();
  }
}

async function fetchArticle(page: Page, source: WeChatSourceConfig, url: string, timezone: string) {
  if (url.includes("weixin.sogou.com/link")) {
    await page.goto("https://weixin.sogou.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);
  }
  await openPage(page, url);
  if (url.includes("weixin.sogou.com/link")) {
    await page.waitForTimeout(12_000);
  }
  await waitForArticleReady(page, source);
  const finalUrl = page.url();

  const html = await page.content();
  const [title, accountName, publishTimeRaw, rawContent, directProfileUrl] = await Promise.all([
    extractText(page, buildArticleTextSelectors(source)),
    extractText(page, buildAccountSelectors(source)),
    extractText(page, buildPublishTimeSelectors(source)),
    extractLargeText(page, buildContentSelectors(source)),
    extractLink(page, buildProfileLinkSelectors(source)),
  ]);

  if (!title) {
    throw new Error(`无法解析文章标题: ${url}`);
  }

  if (!publishTimeRaw) {
    throw new Error(`无法解析文章发布时间: ${url}`);
  }

  const publishedAt = parseWeChatPublishedAt(publishTimeRaw, timezone);
  const content = rawContent?.trim() ?? "";
  const cleanedContent = cleanArticleContent(content);

  if (cleanedContent.length < 40) {
    throw new Error(`正文内容过短，疑似未抓取成功: ${url}`);
  }

  const articleUrls = buildStoredArticleUrls(finalUrl, html);
  const bizId = extractBizId(articleUrls.normalizedUrl, html);
  const profileUrl = deriveProfileUrl(directProfileUrl, articleUrls.normalizedUrl, html, bizId);

  const fetched: FetchedArticle = {
    url: articleUrls.url,
    normalizedUrl: articleUrls.normalizedUrl,
    sourceId: source.id,
    sourceName: source.accountName,
    title,
    publishedAt,
    discoveredAt: new Date().toISOString(),
    content,
    cleanedContent,
    excerpt: buildExcerpt(cleanedContent),
    contentHash: buildContentHash(cleanedContent),
    ...compactOptional({
      accountName: accountName ?? source.accountName,
      profileUrl,
      bizId,
    }),
  };

  return fetched;
}

function buildSogouSearchUrl(query: string): string {
  return `${SOGOU_SEARCH_URL}${encodeURIComponent(query)}`;
}

async function collectArticleCandidatesFromSogou(
  page: Page,
  source: WeChatSourceConfig,
): Promise<ArticleCandidate[]> {
  const dedupeCandidates = (rows: SearchResultRow[]): ArticleCandidate[] => {
    const deduped = new Map<string, ArticleCandidate>();

    for (const candidate of rows) {
      if (!candidate.url) {
        continue;
      }

      if (!deduped.has(candidate.url)) {
        deduped.set(
          candidate.url,
          compactOptional({
            url: candidate.url,
            titleHint: candidate.titleHint,
            publishedAtHint: candidate.publishedAtHint,
          }),
        );
      }
    }

    return Array.from(deduped.values()).slice(0, source.maxArticlesPerCheck * 4);
  };

  let firstLooseMatches: SearchResultRow[] = [];
  const now = DateTime.now().setZone("Asia/Shanghai");

  for (const query of buildSearchQueries(source, now)) {
    const queryMatches: SearchResultRow[] = [];

    for (let pageIndex = 1; pageIndex <= SOGOU_MAX_PAGES; pageIndex += 1) {
      await openPage(page, `${buildSogouSearchUrl(query)}&page=${pageIndex}`);

      const rawCandidates = await page.evaluate(
        ({ limit }) =>
          Array.from(document.querySelectorAll('li[id^="sogou_vr_11002601_box_"]'))
            .map((item) => {
              const link = item.querySelector('a[id^="sogou_vr_11002601_title_"]');
              const metaText = item
                .querySelector(".s-p")
                ?.textContent?.replace(/\s+/g, " ")
                .trim();
              const account = item
                .querySelector(".s-p .all-time-y2")
                ?.textContent?.replace(/\s+/g, " ")
                .trim();
              const titleHint = link?.textContent?.replace(/\s+/g, " ").trim() || undefined;
              const href = link instanceof HTMLAnchorElement ? link.href : undefined;

              return {
                account,
                titleHint,
                url: href,
                publishedAtHint: metaText,
              };
            })
            .filter((item) => Boolean(item.url))
            .slice(0, limit * 4),
        {
          limit: source.maxArticlesPerCheck,
        },
      );

      queryMatches.push(...rawCandidates);
    }

    const strictMatches = queryMatches
      .filter((item) =>
      isLikelySameAccount(item.account, source.accountName),
      )
      .sort((left, right) => {
        const leftTime = parseSogouResultTimestamp(left.publishedAtHint, now);
        const rightTime = parseSogouResultTimestamp(right.publishedAtHint, now);
        return (rightTime ?? "").localeCompare(leftTime ?? "");
      });

    if (strictMatches.length > 0) {
      return dedupeCandidates(strictMatches);
    }

    if (firstLooseMatches.length === 0) {
      firstLooseMatches = queryMatches;
    }
  }

  return dedupeCandidates(firstLooseMatches);
}

async function collectArticleCandidatesFromFeeds(
  source: WeChatSourceConfig,
): Promise<ArticleCandidate[]> {
  const feedUrls = source.rssFeedUrls ?? [];
  const deduped = new Map<string, ArticleCandidate>();

  for (const feedUrl of feedUrls) {
    const candidates = await fetchFeedCandidates(feedUrl);

    for (const candidate of candidates) {
      if (deduped.has(candidate.url)) {
        continue;
      }

      deduped.set(candidate.url, candidate);

      if (deduped.size >= source.maxArticlesPerCheck) {
        return Array.from(deduped.values());
      }
    }
  }

  return Array.from(deduped.values());
}

async function collectArticleCandidates(
  listPage: Page,
  source: WeChatSourceConfig,
  discoveryMode: DiscoveryMode = "hybrid",
): Promise<ArticleCandidate[]> {
  const errors: string[] = [];
  const methods = resolveDiscoveryMethods(source, discoveryMode);
  const canUseFeeds = methods.includes("feed");
  const canUseSogou = methods.includes("sogou");

  if (canUseFeeds) {
    try {
      const candidates = await collectArticleCandidatesFromFeeds(source);
      if (candidates.length > 0) {
        return candidates;
      }
      errors.push("订阅源未找到可用文章链接，请检查 rssFeedUrls。");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (!canUseSogou) {
    if (!canUseFeeds) {
      errors.push("rss-only 模式要求为该公众号配置 rssFeedUrls。");
    }
    throw new Error(errors.join("；"));
  }

  try {
    const candidates = await collectArticleCandidatesFromSogou(listPage, source);
    if (candidates.length > 0) {
      return candidates;
    }
    errors.push("搜狗文章搜索未找到该公众号的结果，请调整 searchQuery。");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  throw new Error(errors.join("；"));
}

function toStoredArticle(
  fetched: FetchedArticle,
  config: AppConfig,
): StoredArticle {
  return {
    ...fetched,
    reportDate: getReportDateForLateAwareDiscovery(
      fetched.publishedAt,
      fetched.discoveredAt,
      config.schedule,
    ),
    summaryStatus: "pending",
  };
}

function isArticleFromExpectedSource(
  fetched: FetchedArticle,
  source: WeChatSourceConfig,
  state: AppState,
): boolean {
  const expectedBizId = state.sources[source.id]?.bootstrap?.bizId;
  if (sameBizId(fetched.bizId, expectedBizId)) {
    return true;
  }

  return isLikelySameAccount(fetched.accountName, source.accountName);
}

export async function bootstrapSources(
  config: AppConfig,
  state: AppState,
  options: { headless: boolean },
): Promise<SourceBootstrapMetadata[]> {
  return withWechatContext(config, options.headless, async (context) => {
    const page = await context.newPage();
    const results: SourceBootstrapMetadata[] = [];

    try {
      for (const source of config.sources) {
        ensureSourceState(state, source);
        const article = await fetchArticle(page, source, source.seedArticleUrl, config.schedule.timezone);
        const metadata: SourceBootstrapMetadata = compactOptional({
          derivedAt: new Date().toISOString(),
          articleTitle: article.title,
          accountName: article.accountName,
          bizId: article.bizId,
          derivedProfileUrl: source.profileUrl ?? article.profileUrl,
        });

        saveBootstrapMetadata(state, source.id, metadata);
        results.push(metadata);
      }

      return results;
    } finally {
      await page.close();
    }
  });
}

export interface CheckResult {
  newArticles: StoredArticle[];
  failures: ReportFailure[];
}

function isUsableProfileUrl(profileUrl: string | undefined): profileUrl is string {
  if (!profileUrl) {
    return false;
  }

  return Boolean(getBizIdFromProfileUrl(profileUrl));
}

export async function checkSources(
  config: AppConfig,
  state: AppState,
  options: { headless: boolean; discoveryMode?: DiscoveryMode },
): Promise<CheckResult> {
  const reportDate = getReportDateForTimestamp(new Date().toISOString(), config.schedule);
  const newArticles: StoredArticle[] = [];
  const failures: ReportFailure[] = [];

  await withWechatContext(config, options.headless, async (context) => {
    const listPage = await context.newPage();
    const articlePage = await context.newPage();

    try {
      for (const source of config.sources) {
        const sourceState = ensureSourceState(state, source);
        const failureBase = {
          sourceId: source.id,
          sourceName: source.accountName,
          failedAt: new Date().toISOString(),
        };

        try {
          const candidates = await collectArticleCandidates(
            listPage,
            source,
            options.discoveryMode ?? "hybrid",
          );

          for (const candidate of candidates) {
            if (
              Object.values(state.articles).some(
                (article) => article.url === candidate.url || article.normalizedUrl === candidate.url,
              )
            ) {
              rememberProcessedUrl(state, source.id, candidate.url);
              continue;
            }

            if (!isSearchCandidateFresh(candidate, reportDate, config, source)) {
              rememberProcessedUrl(state, source.id, candidate.url);
              continue;
            }

            const fetched = await fetchArticle(
              articlePage,
              source,
              candidate.url,
              config.schedule.timezone,
            );

            if (!isArticleFromExpectedSource(fetched, source, state)) {
              continue;
            }

            const stored = toStoredArticle(fetched, config);
            if (
              !isTimestampFreshForReport(
                stored.publishedAt,
                reportDate,
                config.schedule,
                source.maxArticleAgeDays,
              )
            ) {
              rememberProcessedUrl(state, source.id, candidate.url);
              rememberProcessedUrl(state, source.id, stored.normalizedUrl);
              continue;
            }

            const result = upsertArticle(state, stored);
            rememberProcessedUrl(state, source.id, stored.normalizedUrl);

            if (result.isNew) {
              newArticles.push(result.article);
            }
          }

          sourceState.lastCheckedAt = new Date().toISOString();
          delete sourceState.lastError;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failure: ReportFailure = {
            ...failureBase,
            message,
          };
          sourceState.lastCheckedAt = new Date().toISOString();
          sourceState.lastError = message;
          addFailureForReportDate(state, reportDate, failure);
          failures.push(failure);
        }
      }
    } finally {
      await articlePage.close();
      await listPage.close();
    }
  });

  return { newArticles, failures };
}

export const __internal = {
  buildStoredArticleUrls,
  sanitizeDerivedProfileUrl,
  isUsableProfileUrl,
  buildProfileUrlFromBizId,
  getBizIdFromProfileUrl,
  buildSogouSearchUrl,
  buildSearchQueries,
  parseSogouResultTimestamp,
  isSearchCandidateFresh,
  isLikelySameAccount,
  sameBizId,
  resolveDiscoveryMethods,
};
