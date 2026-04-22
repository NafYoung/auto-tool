import { describe, expect, it } from "vitest";
import { createEmptyState, upsertArticle } from "../src/state.js";
import type { StoredArticle } from "../src/types.js";

function buildArticle(overrides: Partial<StoredArticle> = {}): StoredArticle {
  return {
    url: "https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1&sn=123",
    normalizedUrl: "https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1&sn=123",
    sourceId: "source",
    sourceName: "来源",
    title: "测试标题",
    publishedAt: "2026-04-01T10:00:00+08:00",
    discoveredAt: "2026-04-01T10:01:00+08:00",
    reportDate: "2026-04-01",
    content: "正文",
    cleanedContent: "正文",
    excerpt: "正文",
    contentHash: "hash-1",
    summaryStatus: "pending",
    ...overrides,
  };
}

describe("state upsert", () => {
  it("dedupes by normalized url", () => {
    const state = createEmptyState();
    const first = upsertArticle(state, buildArticle());
    const second = upsertArticle(state, buildArticle());

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false);
    expect(Object.keys(state.articles)).toHaveLength(1);
  });

  it("resets summary when content hash changes", () => {
    const state = createEmptyState();
    upsertArticle(state, buildArticle({ summaryStatus: "completed", summaryBullets: ["a", "b", "c"] }));
    const next = upsertArticle(state, buildArticle({ contentHash: "hash-2", cleanedContent: "新版正文" }));

    expect(next.article.summaryStatus).toBe("pending");
    expect(next.article.summaryBullets).toBeUndefined();
  });

  it("preserves first discoveredAt and reportDate on repeated crawls", () => {
    const state = createEmptyState();
    upsertArticle(
      state,
      buildArticle({
        discoveredAt: "2026-04-01T18:00:00+08:00",
        reportDate: "2026-04-01",
      }),
    );
    const next = upsertArticle(
      state,
      buildArticle({
        discoveredAt: "2026-04-02T10:00:00+08:00",
        reportDate: "2026-04-02",
        contentHash: "hash-2",
      }),
    );

    expect(next.article.discoveredAt).toBe("2026-04-01T18:00:00+08:00");
    expect(next.article.reportDate).toBe("2026-04-01");
  });

  it("allows a later recrawl to move an article into an earlier report date", () => {
    const state = createEmptyState();
    upsertArticle(
      state,
      buildArticle({
        discoveredAt: "2026-04-09T19:15:00+08:00",
        reportDate: "2026-04-10",
      }),
    );
    const next = upsertArticle(
      state,
      buildArticle({
        discoveredAt: "2026-04-09T19:30:00+08:00",
        reportDate: "2026-04-09",
      }),
    );

    expect(next.article.discoveredAt).toBe("2026-04-09T19:15:00+08:00");
    expect(next.article.reportDate).toBe("2026-04-09");
  });
});
