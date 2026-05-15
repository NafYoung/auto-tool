import { load } from "cheerio";
import { DateTime } from "luxon";
import { buildContentHash, buildExcerpt, cleanArticleContent, normalizeWeChatUrl } from "./pipeline.js";
import type { ArticleCandidate, FetchedArticle, WeChatSourceConfig } from "./types.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface ScraperSiteConfig {
  listUrl: string;
  parseListHtml: (html: string) => ArticleCandidate[];
  parseArticleHtml: (html: string, url: string) => { title: string; content: string; publishedAt: string } | null;
}

// ============================================================
// 迈点 (meadin.com)
// ============================================================
const MEADIN_CATEGORIES: Record<string, string> = {
  wl: "文旅",
  jd: "酒店",
  jq: "景区",
  cx: "出行",
  report: "研究报告",
  yj: "行业研究",
};

function parseMeadinList(html: string): ArticleCandidate[] {
  const $ = load(html);
  const candidates: ArticleCandidate[] = [];

  $(".news-box").each((_, el) => {
    const $el = $(el);
    const titleLink = $el.find('h3 a[data-cut="newtitle"]');
    const title = titleLink.text().trim();
    const href = titleLink.attr("href") ?? "";
    const desc = $el.find('p[data-cut="metaDes"]').text().trim();

    if (title && href && href.includes(".html")) {
      const url = href.startsWith("http") ? href : `https://www.meadin.com${href}`;
      candidates.push({
        url,
        titleHint: title,
        contentHint: desc || undefined,
      });
    }
  });

  return candidates;
}

function parseMeadinArticle(html: string, url: string): { title: string; content: string; publishedAt: string } | null {
  const $ = load(html);

  // 从 JSON-LD 提取日期
  let publishedAt = "";
  const ldScript = $('script[type="application/ld+json"]').first().text();
  if (ldScript) {
    try {
      const ld = JSON.parse(ldScript);
      publishedAt = ld.datePublished ?? "";
    } catch {
      // ignore
    }
  }

  // 标题：取第一个非模板的 h1
  let title = "";
  $("h1.news-h1").each((_, el) => {
    const t = $(el).text().trim();
    if (t && !t.includes("{{") && !title) {
      title = t;
    }
  });
  if (!title) {
    title = $("title").text().replace(/_迈点网$/, "").trim();
  }

  // 内容：取第一个有实际内容的 article 元素
  let content = "";
  $(".article.js-article").each((_, el) => {
    if (content) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > 20 && !text.includes("{{{")) {
      content = text;
    }
  });

  // 如果纯文本为空，提取图片 alt 文本
  if (!content) {
    const altTexts: string[] = [];
    $(".article.js-article img").each((_, el) => {
      const alt = $(el).attr("alt")?.trim();
      if (alt) altTexts.push(alt);
    });
    content = altTexts.join("。");
  }

  if (!title) return null;
  return { title, content: (content || title).substring(0, 3000), publishedAt };
}

// ============================================================
// 执惠 (tripvivid.com)
// ============================================================
function parseTripvividArticle(html: string, url: string): { title: string; content: string; publishedAt: string } | null {
  const $ = load(html);

  let publishedAt = "";
  // 尝试从 meta 或 JSON-LD 提取
  const ldScript = $('script[type="application/ld+json"]').first().text();
  if (ldScript) {
    try {
      const ld = JSON.parse(ldScript);
      publishedAt = ld.datePublished ?? "";
    } catch {
      // ignore
    }
  }

  // 从 URL 提取日期作为回退
  if (!publishedAt) {
    const dateMatch = url.match(/\/(\d{4})[/-](\d{2})[/-](\d{2})\//);
    if (dateMatch) {
      publishedAt = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    }
  }

  const title = $("h1").first().text().trim() ?? $("title").text().trim();
  const contentEl = $(".article-content, .content-detail, article").first();
  contentEl.find("script, style").remove();
  const content = contentEl.text().replace(/\s+/g, " ").trim();

  if (!title || content.length < 50) return null;
  return { title, content: content.substring(0, 3000), publishedAt };
}

// ============================================================
// 通用爬取逻辑
// ============================================================

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`请求失败: ${url} (${response.status})`);
  }
  return response.text();
}

/**
 * 从网站列表页抓取文章候选
 */
export async function scrapeListCandidates(
  source: WeChatSourceConfig,
): Promise<ArticleCandidate[]> {
  const feedUrls = source.rssFeedUrls ?? [];
  const allCandidates: ArticleCandidate[] = [];

  for (const listUrl of feedUrls) {
    const html = await fetchHtml(listUrl);
    const candidates = parseMeadinList(html);

    for (const c of candidates) {
      if (!allCandidates.some((existing) => existing.url === c.url)) {
        allCandidates.push(c);
      }
    }
  }

  // 关键词过滤
  if (source.keywordFilter?.length) {
    const keywords = source.keywordFilter;
    return allCandidates.filter((c) => {
      const text = [c.titleHint ?? "", c.contentHint ?? ""].join(" ").toLowerCase();
      return keywords.some((kw) => text.includes(kw.toLowerCase()));
    });
  }

  return allCandidates.slice(0, source.maxArticlesPerCheck);
}

/**
 * 抓取单篇文章的完整内容
 */
export async function scrapeArticle(
  url: string,
  source: WeChatSourceConfig,
  timezone: string,
): Promise<FetchedArticle> {
  const html = await fetchHtml(url);

  let parsed: { title: string; content: string; publishedAt: string } | null = null;

  if (url.includes("meadin.com")) {
    parsed = parseMeadinArticle(html, url);
  } else if (url.includes("tripvivid.com")) {
    parsed = parseTripvividArticle(html, url);
  }

  if (!parsed) {
    throw new Error(`无法解析文章: ${url}`);
  }

  const cleanedContent = cleanArticleContent(parsed.content);
  if (cleanedContent.length < 40) {
    throw new Error(`文章内容过短: ${url}`);
  }

  // 解析发布时间
  let publishedAt: string;
  if (parsed.publishedAt) {
    const dt = DateTime.fromISO(parsed.publishedAt, { zone: timezone });
    publishedAt = dt.isValid ? (dt.toISO() ?? new Date().toISOString()) : new Date().toISOString();
  } else {
    publishedAt = new Date().toISOString();
  }

  const normalizedUrl = normalizeWeChatUrl(url);

  return {
    url: normalizedUrl,
    normalizedUrl,
    sourceId: source.id,
    sourceName: source.accountName,
    title: parsed.title,
    publishedAt,
    discoveredAt: new Date().toISOString(),
    content: parsed.content,
    cleanedContent,
    excerpt: buildExcerpt(cleanedContent),
    contentHash: buildContentHash(cleanedContent),
    accountName: source.accountName,
  };
}
