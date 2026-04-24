import { XMLParser } from "fast-xml-parser";
import type { ArticleCandidate } from "./types.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
});

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

    deduped.set(url, {
      url,
      ...(pickEntryTitle(entry) ? { titleHint: pickEntryTitle(entry) } : {}),
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
};
