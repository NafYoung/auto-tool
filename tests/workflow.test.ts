import { describe, expect, it } from "vitest";
import {
  ensureNoSourceFailures,
  hasReportArticleDelta,
  resolvePersistedDeliveryOrigin,
  resolvePersistedEmailedAt,
  shouldSkipLocalFallback,
  shouldSkipEmailBecauseAlreadyMarked,
} from "../src/workflow.js";
import type { ReportFailure, StoredArticle, StoredReport } from "../src/types.js";

function buildFailure(overrides: Partial<ReportFailure> = {}): ReportFailure {
  return {
    sourceId: "source-1",
    sourceName: "数字文旅观察",
    failedAt: "2026-04-07T19:00:00+08:00",
    message: "订阅源请求失败",
    ...overrides,
  };
}

describe("ensureNoSourceFailures", () => {
  it("does nothing when strict mode is disabled", () => {
    expect(() => ensureNoSourceFailures([buildFailure()], false)).not.toThrow();
  });

  it("throws a summarized error when strict mode is enabled", () => {
    expect(() =>
      ensureNoSourceFailures(
        [
          buildFailure(),
          buildFailure({
            sourceId: "source-2",
            sourceName: "上海文旅产业研究院",
          }),
        ],
        true,
      ),
    ).toThrowError("本次抓取存在 2 个来源异常，已中止日报发送：数字文旅观察、上海文旅产业研究院");
  });
});

describe("manual test email behavior", () => {
  it("does not skip manual test send when report was already formally sent", () => {
    expect(
      shouldSkipEmailBecauseAlreadyMarked({
        alreadySent: "2026-04-08T19:00:00+08:00",
        sendEmail: true,
        markAsSent: false,
        force: false,
      }),
    ).toBe(false);
  });

  it("preserves existing emailedAt when manual test send should not mark the day as sent", () => {
    expect(
      resolvePersistedEmailedAt({
        existingEmailedAt: "2026-04-08T19:00:00+08:00",
        sendEmail: true,
        markAsSent: false,
        sentAt: "2026-04-08T20:00:00+08:00",
      }),
    ).toBe("2026-04-08T19:00:00+08:00");
  });
});

describe("cloud and local delivery ownership", () => {
  it("skips local fallback when canonical state already shows a formal send", () => {
    expect(
      shouldSkipLocalFallback({
        deliveryOrigin: "local",
        existingReport: {
          date: "2026-04-17",
          generatedAt: "2026-04-17T20:15:00+08:00",
          emailedAt: "2026-04-17T20:15:00+08:00",
          articleUrls: [],
          failureCount: 0,
          skipped: false,
          deliveryOrigin: "cloud",
        },
      }),
    ).toBe(true);
  });

  it("persists the delivery origin only for formal sends", () => {
    expect(
      resolvePersistedDeliveryOrigin({
        existingDeliveryOrigin: "cloud",
        sendEmail: true,
        markAsSent: false,
        deliveryOrigin: "local",
      }),
    ).toBe("cloud");

    expect(
      resolvePersistedDeliveryOrigin({
        sendEmail: true,
        markAsSent: true,
        deliveryOrigin: "local",
      }),
    ).toBe("local");
  });
});

describe("late article resend behavior", () => {
  function buildArticle(overrides: Partial<StoredArticle> = {}): StoredArticle {
    return {
      url: "https://mp.weixin.qq.com/s?src=11&signature=one",
      normalizedUrl: "https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1",
      sourceId: "source-1",
      sourceName: "上海文旅产业研究院",
      title: "文章一",
      publishedAt: "2026-04-09T13:22:00+08:00",
      discoveredAt: "2026-04-09T19:30:00+08:00",
      reportDate: "2026-04-09",
      content: "正文",
      cleanedContent: "正文",
      excerpt: "正文",
      contentHash: "hash",
      summaryStatus: "pending",
      ...overrides,
    };
  }

  function buildReport(overrides: Partial<StoredReport> = {}): StoredReport {
    return {
      date: "2026-04-09",
      generatedAt: "2026-04-09T19:00:00+08:00",
      emailedAt: "2026-04-09T19:00:00+08:00",
      articleUrls: ["https://mp.weixin.qq.com/s?src=11&signature=old"],
      articleKeys: ["https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1"],
      failureCount: 0,
      skipped: false,
      ...overrides,
    };
  }

  it("does not treat refreshed signed urls as new articles", () => {
    expect(
      hasReportArticleDelta(buildReport(), [
        buildArticle({
          url: "https://mp.weixin.qq.com/s?src=11&signature=new",
        }),
      ]),
    ).toBe(false);
  });

  it("treats unseen normalized article identities as late-arriving additions", () => {
    expect(
      hasReportArticleDelta(buildReport(), [
        buildArticle(),
        buildArticle({
          url: "https://mp.weixin.qq.com/s?src=11&signature=late",
          normalizedUrl: "https://mp.weixin.qq.com/s?__biz=abc&mid=2&idx=1",
          title: "文章二",
        }),
      ]),
    ).toBe(true);
  });
});
