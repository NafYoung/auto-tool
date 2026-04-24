import { describe, expect, it } from "vitest";
import { renderDailyReportMarkdown } from "../src/report.js";
import type { AppConfig } from "../src/types.js";

const config: AppConfig = {
  browserProfilePath: "/tmp/browser",
  dataDir: "/tmp/data",
  reportDir: "/tmp/reports",
  schedule: {
    timezone: "Asia/Shanghai",
    dailyReportTime: "19:00",
    cloudPrimarySendTime: "20:15",
    localFallbackSendTime: "20:30",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    temperature: 0.3,
    maxOutputTokens: 800,
  },
  email: {
    from: "digest@example.com",
    subjectPrefix: "日报",
  },
  sources: [],
};

describe("daily report rendering", () => {
  it("renders a status report when there are no articles", () => {
    const markdown = renderDailyReportMarkdown({
      config,
      reportDate: "2026-04-23",
      articles: [],
      overview: "今天没有发现符合条件的新文章。",
      failures: [],
    });

    expect(markdown).toContain("## 今日总览");
    expect(markdown).toContain("今天没有发现符合条件的新文章。");
    expect(markdown).toContain("## 文章摘要");
    expect(markdown).toContain("暂无新文章。");
  });
});
