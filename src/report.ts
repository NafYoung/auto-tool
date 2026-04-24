import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatDisplayTime, getReportWindow } from "./digest.js";
import type { AppConfig, ReportFailure, StoredArticle } from "./types.js";

export function renderDailyReportMarkdown(args: {
  config: AppConfig;
  reportDate: string;
  articles: StoredArticle[];
  overview: string;
  failures: ReportFailure[];
}): string {
  const { config, reportDate, articles, overview, failures } = args;
  const window = getReportWindow(reportDate, config.schedule);

  const lines: string[] = [
    `# 文旅公众号日报｜${reportDate}`,
    "",
    `统计窗口：${formatDisplayTime(window.start, config.schedule.timezone)} - ${formatDisplayTime(window.end, config.schedule.timezone)}`,
    "",
    "## 今日总览",
    "",
    overview,
    "",
    "## 文章摘要",
    "",
  ];

  for (const article of articles) {
    lines.push(`### ${article.title}`);
    lines.push("");
    lines.push(`- 来源：${article.sourceName}`);
    lines.push(`- 发布时间：${formatDisplayTime(article.publishedAt, config.schedule.timezone)}`);
    lines.push(`- 链接：${article.url}`);

    if (article.summaryStatus === "completed" && article.summaryBullets?.length) {
      for (const bullet of article.summaryBullets) {
        lines.push(`- ${bullet}`);
      }
    } else {
      lines.push(`- 摘要生成失败：${article.summaryError ?? "未获取到摘要结果"}`);
      lines.push(`- 正文摘录：${article.excerpt}`);
    }

    lines.push("");
  }

  if (articles.length === 0) {
    lines.push("暂无新文章。");
    lines.push("");
  }

  if (failures.length > 0) {
    lines.push("## 抓取异常");
    lines.push("");
    for (const failure of failures) {
      lines.push(`- ${failure.sourceName}：${failure.message}（${formatDisplayTime(failure.failedAt, config.schedule.timezone)}）`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export async function saveReportMarkdown(
  reportDir: string,
  reportDate: string,
  markdown: string,
): Promise<string> {
  await mkdir(reportDir, { recursive: true });
  const outputPath = path.join(reportDir, `${reportDate}.md`);
  await writeFile(outputPath, markdown, "utf8");
  return outputPath;
}
