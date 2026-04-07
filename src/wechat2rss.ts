import { readFile, writeFile } from "node:fs/promises";
import { resolveConfigPath, type Wechat2RssRuntime } from "./config.js";

interface Wechat2RssAddUrlSuccess {
  err?: undefined;
  data?: string;
}

interface Wechat2RssAddUrlFailure {
  err?: string;
  data?: unknown;
}

type Wechat2RssAddUrlResponse = Wechat2RssAddUrlSuccess | Wechat2RssAddUrlFailure;

interface SourceConfigRecord {
  id?: unknown;
  seedArticleUrl?: unknown;
  rssFeedUrls?: unknown;
}

interface ConfigRecord {
  sources?: unknown;
}

export interface FeedSyncResult {
  sourceId: string;
  accountName: string;
  seedArticleUrl: string;
  feedUrl: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function buildWechat2RssAddUrlApiUrl(
  baseUrl: string,
  token: string,
  articleUrl: string,
): string {
  const endpoint = new URL("/addurl", baseUrl);
  endpoint.searchParams.set("k", token);
  endpoint.searchParams.set("url", articleUrl);
  return endpoint.toString();
}

export function parseWechat2RssAddUrlResponse(payload: unknown): string {
  if (!isObject(payload)) {
    throw new Error("Wechat2RSS 返回格式非法：响应不是 JSON 对象。");
  }

  const response = payload as Wechat2RssAddUrlResponse;

  if (typeof response.err === "string" && response.err.trim()) {
    throw new Error(`Wechat2RSS 返回错误：${response.err.trim()}`);
  }

  if (typeof response.data !== "string" || response.data.trim() === "") {
    throw new Error("Wechat2RSS 返回格式非法：缺少 feed URL。");
  }

  return response.data.trim();
}

export async function addWechat2RssFeedBySeedArticle(
  runtime: Wechat2RssRuntime,
  articleUrl: string,
): Promise<string> {
  const requestUrl = buildWechat2RssAddUrlApiUrl(runtime.baseUrl, runtime.token, articleUrl);
  const response = await fetch(requestUrl, {
    headers: {
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Wechat2RSS 请求失败: ${requestUrl} (${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  return parseWechat2RssAddUrlResponse(payload);
}

export function applyWechat2RssFeedUrls(
  rawConfig: unknown,
  updates: Record<string, string>,
): ConfigRecord {
  if (!isObject(rawConfig)) {
    throw new Error("配置文件格式非法：根对象不是 JSON 对象。");
  }

  const config = rawConfig as ConfigRecord;

  if (!Array.isArray(config.sources)) {
    throw new Error("配置文件格式非法：sources 不是数组。");
  }

  const nextSources = config.sources.map((source) => {
    if (!isObject(source)) {
      return source;
    }

    const sourceRecord = source as SourceConfigRecord;
    const sourceId = typeof sourceRecord.id === "string" ? sourceRecord.id : undefined;
    if (!sourceId || !updates[sourceId]) {
      return source;
    }

    return {
      ...source,
      rssFeedUrls: [updates[sourceId]],
    };
  });

  return {
    ...config,
    sources: nextSources,
  };
}

export async function syncWechat2RssFeeds(
  configPath: string,
  runtime: Wechat2RssRuntime,
  options: { dryRun?: boolean } = {},
): Promise<FeedSyncResult[]> {
  const absoluteConfigPath = resolveConfigPath(configPath);
  const rawText = await readFile(absoluteConfigPath, "utf8");
  const rawConfig = JSON.parse(rawText) as unknown;

  if (!isObject(rawConfig) || !Array.isArray(rawConfig.sources)) {
    throw new Error("配置文件格式非法：缺少 sources 数组。");
  }

  const results: FeedSyncResult[] = [];

  for (const source of rawConfig.sources) {
    if (!isObject(source)) {
      continue;
    }

    const sourceId = typeof source.id === "string" ? source.id : undefined;
    const accountName = typeof source.accountName === "string" ? source.accountName : undefined;
    const seedArticleUrl =
      typeof source.seedArticleUrl === "string" ? source.seedArticleUrl : undefined;

    if (!sourceId || !accountName || !seedArticleUrl) {
      continue;
    }

    const feedUrl = await addWechat2RssFeedBySeedArticle(runtime, seedArticleUrl);
    results.push({
      sourceId,
      accountName,
      seedArticleUrl,
      feedUrl,
    });
  }

  if (!options.dryRun) {
    const updatedConfig = applyWechat2RssFeedUrls(
      rawConfig,
      Object.fromEntries(results.map((item) => [item.sourceId, item.feedUrl])),
    );
    await writeFile(absoluteConfigPath, `${JSON.stringify(updatedConfig, null, 2)}\n`, "utf8");
  }

  return results;
}

export const __internal = {
  buildWechat2RssAddUrlApiUrl,
  parseWechat2RssAddUrlResponse,
  applyWechat2RssFeedUrls,
};
