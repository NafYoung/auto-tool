import { XMLParser } from "fast-xml-parser";
import { load } from "cheerio";
import type { ArticleCandidate } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});
const MIN_FALLBACK_CONTENT_HINT_LENGTH = 120;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text || undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = readText(item);
      if (text) {
        return text;
      }
    }

    return undefined;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return (
      readText(record["#text"]) ??
      readText(record.href) ??
      readText(record.url) ??
      readText(record.value)
    );
  }

  return undefined;
}

function pickUrl(value: unknown): string | undefined {
  const text = readText(value);
  if (!text) {
    return undefined;
  }

  if (!/^https?:\/\//i.test(text)) {
    return undefined;
  }

  return text;
}

function pickEntryUrl(entry: Record<string, unknown>): string | undefined {
  for (const link of asArray(entry.link)) {
    if (typeof link === "object" && link !== null) {
      const record = link as Record<string, unknown>;
      const href = pickUrl(record.href);
      const rel = readText(record.rel);
      if (href && (!rel || rel === "alternate")) {
        return href;
      }
    }

    const direct = pickUrl(link);
    if (direct) {
      return direct;
    }
  }

  return pickUrl(entry.guid) ?? pickUrl(entry.id);
}

function pickEntryTitle(entry: Record<string, unknown>): string | undefined {
  return readText(entry.title) ?? readText(entry["media:title"]);
}

function htmlToReadableText(input: string): string | undefined {
  const raw = input.trim();
  if (!raw) {
    return undefined;
  }

  const $ = load(raw);
  $("script, style, svg, noscript").remove();

  const richContent = $("#js_content").first();
  const contentRoot =
    richContent.length > 0
      ? richContent
      : $(".rich_media_content").first().length > 0
        ? $(".rich_media_content").first()
        : $("article").first().length > 0
          ? $("article").first()
          : $("body").first();

  contentRoot.find("br").replaceWith("\n");
  contentRoot
    .find("p, div, section, article, h1, h2, h3, h4, h5, h6, li, tr, blockquote")
    .append("\n");

  const text = contentRoot
    .text()
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return text || undefined;
}

function pickEntryPublishedAtHint(entry: Record<string, unknown>): string | undefined {
  return (
    readText(entry.pubDate) ??
    readText(entry.published) ??
    readText(entry.updated) ??
    readText(entry["dc:date"])
  );
}

function pickEntryAccountNameHint(entry: Record<string, unknown>): string | undefined {
  const author = entry.author;
  if (author && typeof author === "object" && !Array.isArray(author)) {
    const name = readText((author as Record<string, unknown>).name);
    if (name) {
      return name;
    }
  }

  return readText(author) ?? readText(entry["dc:creator"]);
}

function pickEntryContentHint(entry: Record<string, unknown>): string | undefined {
  const explicitContent = readText(entry["content:encoded"]) ?? readText(entry.content);
  if (explicitContent) {
    return htmlToReadableText(explicitContent);
  }

  const fallbackContent =
    readText(entry.description) ??
    readText(entry.summary) ??
    readText(entry["media:description"]);
  const text = fallbackContent ? htmlToReadableText(fallbackContent) : undefined;

  return text && text.length >= MIN_FALLBACK_CONTENT_HINT_LENGTH ? text : undefined;
}

function parseFeedEntries(root: unknown): ArticleCandidate[] {
  if (!root || typeof root !== "object") {
    return [];
  }

  const record = root as Record<string, unknown>;
  const rssItems = asArray(((record.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined)?.item);
  const atomEntries = asArray((record.feed as Record<string, unknown> | undefined)?.entry);
  const items = [...rssItems, ...atomEntries].filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );

  const deduped = new Map<string, ArticleCandidate>();

  for (const entry of items) {
    const url = pickEntryUrl(entry);
    if (!url || deduped.has(url)) {
      continue;
    }

    const titleHint = pickEntryTitle(entry);
    const publishedAtHint = pickEntryPublishedAtHint(entry);
    const accountNameHint = pickEntryAccountNameHint(entry);
    const contentHint = pickEntryContentHint(entry);

    deduped.set(url, {
      url,
      ...(titleHint ? { titleHint } : {}),
      ...(publishedAtHint ? { publishedAtHint } : {}),
      ...(accountNameHint ? { accountNameHint } : {}),
      ...(contentHint ? { contentHint } : {}),
    });
  }

  return Array.from(deduped.values());
}

export function parseFeedCandidates(xml: string): ArticleCandidate[] {
  const parsed = parser.parse(xml);
  return parseFeedEntries(parsed);
}

export async function fetchFeedCandidates(feedUrl: string): Promise<ArticleCandidate[]> {
  const response = await fetch(feedUrl, {
    headers: {
      "user-agent": "wenlv-news-digest/0.2 (+cloud-feed-mode)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
    },
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`订阅源请求失败: ${feedUrl} (${response.status})`);
  }

  const xml = await response.text();
  const candidates = parseFeedCandidates(xml);

  if (candidates.length === 0) {
    throw new Error(`订阅源未解析到文章链接: ${feedUrl}`);
  }

  return candidates;
}

export const __internal = {
  parseFeedCandidates,
  htmlToReadableText,
};
