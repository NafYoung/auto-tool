import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DateTime } from "luxon";
import { loadConfig } from "./config.js";
import { loadState } from "./state.js";
import { runCheck, runReport } from "./workflow.js";
import type { AppConfig, AppState, StoredArticle } from "./types.js";

interface ServerOptions {
  port: number;
  configPath?: string;
}

function parseSince(since: string | undefined, timezone: string): string {
  if (!since) {
    return DateTime.now().setZone(timezone).minus({ hours: 24 }).toISO() ?? new Date().toISOString();
  }
  const dt = DateTime.fromISO(since, { zone: "utc" });
  return (dt.isValid ? dt.toISO() : null) ?? DateTime.now().setZone(timezone).minus({ hours: 24 }).toISO() ?? new Date().toISOString();
}

function articleToItem(article: StoredArticle, timezone: string) {
  const pub = DateTime.fromISO(article.publishedAt, { zone: "utc" }).setZone(timezone);
  return {
    id: article.normalizedUrl,
    title: article.title,
    url: article.url,
    source: article.sourceName,
    publishedAt: article.publishedAt,
    publishedAtLocal: pub.toISO() ?? article.publishedAt,
    summary:
      article.summaryStatus === "completed" && article.summaryBullets?.length
        ? article.summaryBullets.join(" ")
        : article.excerpt,
    category: article.sourceId,
    summaryStatus: article.summaryStatus,
  };
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data, null, 2));
}

function sendError(res: ServerResponse, status: number, message: string) {
  sendJson(res, status, { error: message });
}

export async function startServer(options: ServerOptions) {
  const config = await loadConfig(options.configPath);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://localhost:${options.port}`);
    const pathname = url.pathname;

    try {
      // GET /api/public/items
      if (pathname === "/api/public/items" && req.method === "GET") {
        const state = await loadState(config.dataDir);
        const since = parseSince(
          url.searchParams.get("since") ?? undefined,
          config.schedule.timezone,
        );
        const take = Math.min(
          Math.max(Number(url.searchParams.get("take") ?? "50"), 1),
          100,
        );
        const q = url.searchParams.get("q")?.toLowerCase() ?? "";
        const category = url.searchParams.get("category") ?? undefined;

        let articles = Object.values(state.articles).filter((a) => {
          const pub = DateTime.fromISO(a.publishedAt);
          const sinceDt = DateTime.fromISO(since);
          return pub >= sinceDt;
        });

        if (q) {
          articles = articles.filter(
            (a) =>
              a.title.toLowerCase().includes(q) ||
              a.sourceName.toLowerCase().includes(q) ||
              a.excerpt.toLowerCase().includes(q),
          );
        }

        if (category) {
          articles = articles.filter((a) => a.sourceId === category);
        }

        articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
        const items = articles.slice(0, take).map((a) => articleToItem(a, config.schedule.timezone));

        return sendJson(res, 200, {
          count: items.length,
          total: articles.length,
          hasNext: articles.length > take,
          items,
        });
      }

      // GET /api/public/daily
      if (pathname === "/api/public/daily" && req.method === "GET") {
        const state = await loadState(config.dataDir);
        const now = DateTime.now().setZone(config.schedule.timezone);
        const reportDate = now.toISODate() ?? new Date().toISOString().slice(0, 10);
        const report = state.reports[reportDate];

        if (!report) {
          return sendError(res, 404, "今日日报尚未生成，请稍后再试。");
        }

        const articles = Object.values(state.articles)
          .filter((a) => a.reportDate === reportDate)
          .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
          .map((a) => articleToItem(a, config.schedule.timezone));

        return sendJson(res, 200, {
          date: reportDate,
          generatedAt: report.generatedAt,
          emailedAt: report.emailedAt,
          overview: report.overview,
          articleCount: articles.length,
          items: articles,
        });
      }

      // GET /api/public/daily/:date
      const dailyDateMatch = pathname.match(/^\/api\/public\/daily\/(\d{4}-\d{2}-\d{2})$/);
      if (dailyDateMatch?.[1] && req.method === "GET") {
        const date = dailyDateMatch[1];
        const state = await loadState(config.dataDir);
        const report = state.reports[date];

        if (!report) {
          return sendError(res, 404, `${date} 的日报不存在。`);
        }

        const articles = Object.values(state.articles)
          .filter((a) => a.reportDate === date)
          .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
          .map((a) => articleToItem(a, config.schedule.timezone));

        return sendJson(res, 200, {
          date,
          generatedAt: report.generatedAt,
          emailedAt: report.emailedAt,
          overview: report.overview,
          articleCount: articles.length,
          items: articles,
        });
      }

      // GET /api/public/dailies
      if (pathname === "/api/public/dailies" && req.method === "GET") {
        const state = await loadState(config.dataDir);
        const take = Math.min(
          Math.max(Number(url.searchParams.get("take") ?? "30"), 1),
          180,
        );

        const dailies = Object.values(state.reports)
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, take)
          .map((r) => ({
            date: r.date,
            generatedAt: r.generatedAt,
            emailedAt: r.emailedAt,
            articleCount: r.articleKeys?.length ?? r.articleUrls.length,
            overview: r.overview,
          }));

        return sendJson(res, 200, { count: dailies.length, items: dailies });
      }

      // POST /api/admin/check — 触发一次采集
      if (pathname === "/api/admin/check" && req.method === "POST") {
        const result = await runCheck(options.configPath, true);
        return sendJson(res, 200, {
          newArticles: result.newArticles.length,
          failures: result.failures.length,
        });
      }

      // POST /api/admin/report — 触发日报生成
      if (pathname === "/api/admin/report" && req.method === "POST") {
        const date = url.searchParams.get("date") ?? undefined;
        const sendEmail = url.searchParams.has("send-email");
        const report = await runReport({
          configPath: options.configPath,
          reportDate: date,
          sendEmail,
          markAsSent: sendEmail,
        });
        if (!report) {
          return sendError(res, 500, "日报生成失败");
        }
        return sendJson(res, 200, {
          date: report.date,
          articleCount: report.articleKeys?.length ?? report.articleUrls.length,
          emailedAt: report.emailedAt,
        });
      }

      // GET /api/public/health
      if (pathname === "/api/public/health") {
        return sendJson(res, 200, {
          status: "ok",
          timezone: config.schedule.timezone,
          sources: config.sources.map((s) => s.accountName),
        });
      }

      sendError(res, 404, "Not found");
    } catch (error) {
      console.error("[API]", error);
      sendError(res, 500, error instanceof Error ? error.message : String(error));
    }
  });

  server.listen(options.port, () => {
    console.log(`文旅日报 API 已启动: http://localhost:${options.port}`);
    console.log(`  GET  /api/public/items?since=<ISO>&take=50&q=<keyword>`);
    console.log(`  GET  /api/public/daily`);
    console.log(`  GET  /api/public/daily/{YYYY-MM-DD}`);
    console.log(`  GET  /api/public/dailies?take=30`);
    console.log(`  GET  /api/public/health`);
    console.log(`  POST /api/admin/check`);
    console.log(`  POST /api/admin/report?date=YYYY-MM-DD&send-email`);
  });

  return server;
}
