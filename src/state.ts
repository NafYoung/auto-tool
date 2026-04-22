import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AppState,
  ReportFailure,
  SourceBootstrapMetadata,
  StoredArticle,
  StoredReport,
  WeChatSourceConfig,
} from "./types.js";

const STATE_FILE_NAME = "state.json";

export function createEmptyState(): AppState {
  return {
    version: 1,
    sources: {},
    articles: {},
    failuresByReportDate: {},
    reports: {},
  };
}

function getStateFilePath(dataDir: string): string {
  return path.join(dataDir, STATE_FILE_NAME);
}

export async function loadState(dataDir: string): Promise<AppState> {
  await mkdir(dataDir, { recursive: true });
  const stateFile = getStateFilePath(dataDir);

  try {
    const raw = await readFile(stateFile, "utf8");
    return JSON.parse(raw) as AppState;
  } catch (error) {
    const known = error as NodeJS.ErrnoException;
    if (known.code === "ENOENT") {
      return createEmptyState();
    }

    throw error;
  }
}

export async function saveState(dataDir: string, state: AppState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const stateFile = getStateFilePath(dataDir);
  await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
}

export function ensureSourceState(
  state: AppState,
  source: WeChatSourceConfig,
): AppState["sources"][string] {
  if (!state.sources[source.id]) {
    state.sources[source.id] = {
      id: source.id,
      accountName: source.accountName,
      lastProcessedUrls: [],
    };
  }

  return state.sources[source.id]!;
}

export function rememberProcessedUrl(
  state: AppState,
  sourceId: string,
  url: string,
  limit = 20,
): void {
  const sourceState = state.sources[sourceId];
  if (!sourceState) {
    return;
  }

  const next = [url, ...sourceState.lastProcessedUrls.filter((item) => item !== url)];
  sourceState.lastProcessedUrls = next.slice(0, limit);
}

export function saveBootstrapMetadata(
  state: AppState,
  sourceId: string,
  metadata: SourceBootstrapMetadata,
): void {
  const sourceState = state.sources[sourceId];
  if (!sourceState) {
    return;
  }

  sourceState.bootstrap = metadata;
  if (metadata.derivedProfileUrl) {
    sourceState.lastSuccessfulProfileUrl = metadata.derivedProfileUrl;
  }
}

export function upsertArticle(
  state: AppState,
  article: StoredArticle,
): { isNew: boolean; article: StoredArticle } {
  const existing = state.articles[article.normalizedUrl];

  if (!existing) {
    state.articles[article.normalizedUrl] = article;
    return { isNew: true, article };
  }

  const contentChanged = existing.contentHash !== article.contentHash;
  const merged: StoredArticle = {
    ...existing,
    ...article,
    discoveredAt: existing.discoveredAt,
    reportDate:
      article.reportDate < existing.reportDate ? article.reportDate : existing.reportDate,
    summaryStatus: contentChanged ? "pending" : existing.summaryStatus,
  };

  if (contentChanged) {
    delete merged.summaryBullets;
    delete merged.summaryError;
  } else {
    if (existing.summaryBullets) {
      merged.summaryBullets = existing.summaryBullets;
    }
    if (existing.summaryError) {
      merged.summaryError = existing.summaryError;
    }
  }

  state.articles[article.normalizedUrl] = merged;
  return { isNew: false, article: merged };
}

export function getArticlesForReportDate(
  state: AppState,
  reportDate: string,
): StoredArticle[] {
  return Object.values(state.articles)
    .filter((article) => article.reportDate === reportDate)
    .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));
}

export function addFailureForReportDate(
  state: AppState,
  reportDate: string,
  failure: ReportFailure,
): void {
  if (!state.failuresByReportDate[reportDate]) {
    state.failuresByReportDate[reportDate] = [];
  }

  const alreadyExists = state.failuresByReportDate[reportDate].some(
    (item) =>
      item.sourceId === failure.sourceId &&
      item.message === failure.message &&
      item.failedAt === failure.failedAt,
  );

  if (!alreadyExists) {
    state.failuresByReportDate[reportDate].push(failure);
  }
}

export function getFailuresForReportDate(
  state: AppState,
  reportDate: string,
): ReportFailure[] {
  return [...(state.failuresByReportDate[reportDate] ?? [])];
}

export function saveReportMetadata(
  state: AppState,
  report: StoredReport,
): void {
  state.reports[report.date] = report;
}
