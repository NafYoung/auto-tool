import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./types.js";

export const DEFAULT_CONFIG_PATH = "wenlv.config.json";

const selectorsSchema = z
  .object({
    accountName: z.string().min(1).optional(),
    articleTitle: z.string().min(1).optional(),
    articleContent: z.string().min(1).optional(),
    publishTime: z.string().min(1).optional(),
    profileLink: z.string().min(1).optional(),
  })
  .default({});

const sourceSchema = z.object({
  id: z.string().min(1),
  accountName: z.string().min(1),
  seedArticleUrl: z.string().url(),
  searchQuery: z.string().min(1).optional(),
  rssFeedUrls: z.array(z.string().url()).min(1).optional(),
  profileUrl: z.string().url().optional(),
  maxArticlesPerCheck: z.number().int().positive().max(20).default(6),
  selectors: selectorsSchema,
});

const configSchema = z.object({
  browserProfilePath: z.string().min(1),
  dataDir: z.string().default("./data"),
  reportDir: z.string().default("./reports"),
  schedule: z.object({
    timezone: z.string().default("Asia/Shanghai"),
    dailyReportTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  deepseek: z.object({
    baseUrl: z.string().url().default("https://api.deepseek.com"),
    model: z.string().default("deepseek-chat"),
    temperature: z.number().min(0).max(2).default(0.3),
    maxOutputTokens: z.number().int().positive().max(4000).default(800),
  }),
  email: z.object({
    from: z.string().min(1),
    subjectPrefix: z.string().min(1).default("文旅公众号日报"),
    to: z.string().min(1).optional(),
  }),
  sources: z.array(sourceSchema).min(1),
});

function resolveConfigPath(configPath: string): string {
  return path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);
}

function resolveMaybeRelativePath(baseDir: string, inputPath: string): string {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(baseDir, inputPath);
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<AppConfig> {
  const absoluteConfigPath = resolveConfigPath(configPath);
  const raw = await readFile(absoluteConfigPath, "utf8");
  const parsed = configSchema.parse(JSON.parse(raw));
  const baseDir = path.dirname(absoluteConfigPath);
  const email = parsed.email.to
    ? { ...parsed.email, to: parsed.email.to }
    : {
        from: parsed.email.from,
        subjectPrefix: parsed.email.subjectPrefix,
      };
  const sources = parsed.sources.map((source) => ({
    id: source.id,
    accountName: source.accountName,
    seedArticleUrl: source.seedArticleUrl,
    maxArticlesPerCheck: source.maxArticlesPerCheck,
    selectors: source.selectors,
    ...(source.searchQuery ? { searchQuery: source.searchQuery } : {}),
    ...(source.rssFeedUrls ? { rssFeedUrls: source.rssFeedUrls } : {}),
    ...(source.profileUrl ? { profileUrl: source.profileUrl } : {}),
  }));

  return {
    browserProfilePath: resolveMaybeRelativePath(baseDir, parsed.browserProfilePath),
    dataDir: resolveMaybeRelativePath(baseDir, parsed.dataDir),
    reportDir: resolveMaybeRelativePath(baseDir, parsed.reportDir),
    schedule: parsed.schedule,
    deepseek: parsed.deepseek,
    email,
    sources,
  };
}

export function requireEnvVars<T extends string>(
  keys: readonly T[],
  env: NodeJS.ProcessEnv = process.env,
): Record<T, string> {
  const missing = keys.filter((key) => !env[key] || env[key]?.trim() === "");

  if (missing.length > 0) {
    throw new Error(`缺少环境变量: ${missing.join(", ")}`);
  }

  return Object.fromEntries(
    keys.map((key) => [key, env[key]!.trim()]),
  ) as Record<T, string>;
}

export interface DeepSeekRuntime {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
}

export interface EmailRuntime {
  host: string;
  port: number;
  user: string;
  pass: string;
  to: string;
  from: string;
  subjectPrefix: string;
}

export function resolveDeepSeekRuntime(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): DeepSeekRuntime {
  const { DEEPSEEK_API_KEY } = requireEnvVars(["DEEPSEEK_API_KEY"], env);

  return {
    apiKey: DEEPSEEK_API_KEY,
    baseUrl: config.deepseek.baseUrl,
    model: config.deepseek.model,
    temperature: config.deepseek.temperature,
    maxOutputTokens: config.deepseek.maxOutputTokens,
  };
}

export function resolveEmailRuntime(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): EmailRuntime {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = requireEnvVars(
    ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"],
    env,
  );
  const to = config.email.to ?? env.MAIL_TO?.trim();

  if (!to) {
    throw new Error("缺少收件人配置: 请在 MAIL_TO 环境变量或配置文件 email.to 中提供。");
  }

  const port = Number(SMTP_PORT);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`SMTP_PORT 非法: ${SMTP_PORT}`);
  }

  return {
    host: SMTP_HOST,
    port,
    user: SMTP_USER,
    pass: SMTP_PASS,
    to,
    from: config.email.from,
    subjectPrefix: config.email.subjectPrefix,
  };
}
