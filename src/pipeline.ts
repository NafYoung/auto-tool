import crypto from "node:crypto";
import { DateTime } from "luxon";

const NOISE_PATTERNS = [
  /点击蓝字/i,
  /微信扫一扫/i,
  /长按(?:识别|扫码)/,
  /免责声明/,
  /版权归.+所有/,
  /^原标题[:：]/,
  /^供稿[:：]/,
  /^来源[:：]\s*(?!国务院|文旅部|文化和旅游部)/,
  /^图片来源[:：]/,
  /^图源[:：]/,
  /^责编[:：]/,
  /^编辑[:：]/,
];

const TRACKING_QUERY_KEYS = new Set([
  "scene",
  "srcid",
  "sharer_shareinfo",
  "sharer_shareinfo_first",
  "clicktime",
  "enterid",
  "subscene",
  "sessionid",
  "from",
  "mpshare",
  "chksm",
]);

export function normalizeWeChatUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";

  const retained = new URLSearchParams();
  for (const [key, value] of url.searchParams.entries()) {
    if (!TRACKING_QUERY_KEYS.has(key)) {
      retained.set(key, value);
    }
  }

  url.search = retained.toString();
  return url.toString();
}

export function cleanArticleContent(rawText: string): string {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const cleaned: string[] = [];

  for (const line of lines) {
    const isNoise = NOISE_PATTERNS.some((pattern) => pattern.test(line));
    const isTinyDivider = line.length <= 2 && /^[\W_]+$/u.test(line);

    if (isNoise || isTinyDivider) {
      continue;
    }

    if (cleaned[cleaned.length - 1] === line) {
      continue;
    }

    cleaned.push(line);
  }

  return cleaned.join("\n").trim();
}

export function buildExcerpt(content: string, maxLength = 140): string {
  const normalized = content.replace(/\n+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

export function buildContentHash(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

export function parseWeChatPublishedAt(
  rawValue: string,
  timezone: string,
): string {
  const value = rawValue.trim();

  if (/^\d{10}$/.test(value)) {
    return DateTime.fromSeconds(Number(value), { zone: timezone }).toISO()!;
  }

  if (/^\d{13}$/.test(value)) {
    return DateTime.fromMillis(Number(value), { zone: timezone }).toISO()!;
  }

  const normalized = value
    .replace(/[年/]/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const formats = [
    "yyyy-MM-dd HH:mm:ss",
    "yyyy-MM-dd HH:mm",
    "yyyy-M-d HH:mm:ss",
    "yyyy-M-d HH:mm",
    "yyyy-MM-dd",
    "yyyy-M-d",
  ];

  for (const format of formats) {
    const parsed = DateTime.fromFormat(normalized, format, { zone: timezone });
    if (parsed.isValid) {
      return parsed.toISO()!;
    }
  }

  const isoCandidate = DateTime.fromISO(value, { zone: timezone });
  if (isoCandidate.isValid) {
    return isoCandidate.toISO()!;
  }

  throw new Error(`无法解析公众号发布时间: ${rawValue}`);
}
