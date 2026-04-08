export interface SourceSelectors {
  accountName?: string;
  articleTitle?: string;
  articleContent?: string;
  publishTime?: string;
  profileLink?: string;
}

export type DiscoveryMode = "hybrid" | "rss-only" | "search-only";

export interface WeChatSourceConfig {
  id: string;
  accountName: string;
  seedArticleUrl: string;
  searchQuery?: string;
  rssFeedUrls?: string[];
  profileUrl?: string;
  maxArticleAgeDays: number;
  maxArticlesPerCheck: number;
  selectors: SourceSelectors;
}

export interface ScheduleConfig {
  timezone: string;
  dailyReportTime: string;
}

export interface DeepSeekConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

export interface EmailConfig {
  from: string;
  subjectPrefix: string;
  to?: string;
}

export interface AppConfig {
  browserProfilePath: string;
  dataDir: string;
  reportDir: string;
  schedule: ScheduleConfig;
  deepseek: DeepSeekConfig;
  email: EmailConfig;
  sources: WeChatSourceConfig[];
}

export interface SourceBootstrapMetadata {
  derivedAt: string;
  articleTitle?: string;
  accountName?: string;
  bizId?: string;
  derivedProfileUrl?: string;
}

export type SummaryStatus = "pending" | "completed" | "failed";

export interface StoredArticle {
  url: string;
  normalizedUrl: string;
  sourceId: string;
  sourceName: string;
  title: string;
  publishedAt: string;
  discoveredAt: string;
  reportDate: string;
  content: string;
  cleanedContent: string;
  excerpt: string;
  contentHash: string;
  summaryStatus: SummaryStatus;
  summaryBullets?: string[];
  summaryError?: string;
}

export interface StateSourceInfo {
  id: string;
  accountName: string;
  lastCheckedAt?: string;
  lastError?: string;
  lastSuccessfulProfileUrl?: string;
  lastProcessedUrls: string[];
  bootstrap?: SourceBootstrapMetadata;
}

export interface ReportFailure {
  sourceId: string;
  sourceName: string;
  failedAt: string;
  message: string;
}

export interface StoredReport {
  date: string;
  generatedAt: string;
  emailedAt?: string;
  markdownPath?: string;
  articleUrls: string[];
  failureCount: number;
  skipped: boolean;
  overview?: string;
}

export interface AppState {
  version: 1;
  sources: Record<string, StateSourceInfo>;
  articles: Record<string, StoredArticle>;
  failuresByReportDate: Record<string, ReportFailure[]>;
  reports: Record<string, StoredReport>;
}

export interface FetchedArticle {
  url: string;
  normalizedUrl: string;
  sourceId: string;
  sourceName: string;
  title: string;
  publishedAt: string;
  discoveredAt: string;
  content: string;
  cleanedContent: string;
  excerpt: string;
  contentHash: string;
  accountName?: string;
  profileUrl?: string;
  bizId?: string;
}

export interface ArticleCandidate {
  url: string;
  titleHint?: string;
}
