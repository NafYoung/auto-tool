import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { __internal } from "../src/wechat.js";

describe("wechat search helpers", () => {
  it("builds sogou article search url", () => {
    expect(__internal.buildSogouSearchUrl("数字文旅观察 公众号")).toBe(
      "https://weixin.sogou.com/weixin?type=2&query=%E6%95%B0%E5%AD%97%E6%96%87%E6%97%85%E8%A7%82%E5%AF%9F%20%E5%85%AC%E4%BC%97%E5%8F%B7",
    );
  });

  it("builds fallback search queries without duplicates", () => {
    expect(
      __internal.buildSearchQueries({
        id: "source",
        accountName: "数字文旅观察",
        seedArticleUrl: "https://mp.weixin.qq.com/s/example",
        searchQuery: "数字文旅观察 公众号",
        maxArticleAgeDays: 2,
        maxArticlesPerCheck: 6,
        selectors: {},
      }, DateTime.fromISO("2026-04-08T10:00:00+08:00")),
    ).toEqual([
      "数字文旅观察 公众号",
      "数字文旅观察 公众号 2026",
      "数字文旅观察",
      "数字文旅观察 2026",
      "数字文旅观察 微信",
    ]);
  });

  it("matches account names loosely", () => {
    expect(__internal.isLikelySameAccount("数字 文旅观察", "数字文旅观察")).toBe(true);
    expect(__internal.isLikelySameAccount("数字文旅观察官方", "数字文旅观察")).toBe(true);
    expect(__internal.isLikelySameAccount("别的公众号", "数字文旅观察")).toBe(false);
  });

  it("keeps signed wechat url for delivery when sn is unavailable", () => {
    expect(
      __internal.buildStoredArticleUrls(
        "https://mp.weixin.qq.com/s?src=11&timestamp=1775640894&ver=6648&signature=abc123&new=1",
        `
          <script>
            var biz = "MzI2NDE1MDQ1OA==";
            var sn = "";
            var mid = "2247507439";
            var idx = "2";
          </script>
        `,
      ),
    ).toEqual({
      url: "https://mp.weixin.qq.com/s?src=11&timestamp=1775640894&ver=6648&signature=abc123&new=1",
      normalizedUrl: "https://mp.weixin.qq.com/s?__biz=MzI2NDE1MDQ1OA%3D%3D&mid=2247507439&idx=2",
    });
  });

  it("prefers canonical wechat url when sn is available", () => {
    expect(
      __internal.buildStoredArticleUrls(
        "https://mp.weixin.qq.com/s?src=11&timestamp=1775640894&ver=6648&signature=abc123&new=1",
        `
          <script>
            var biz = "MzI2NDE1MDQ1OA==";
            var sn = "deadbeef";
            var mid = "2247507439";
            var idx = "2";
          </script>
        `,
      ),
    ).toEqual({
      url: "https://mp.weixin.qq.com/s?__biz=MzI2NDE1MDQ1OA%3D%3D&mid=2247507439&idx=2&sn=deadbeef",
      normalizedUrl: "https://mp.weixin.qq.com/s?__biz=MzI2NDE1MDQ1OA%3D%3D&mid=2247507439&idx=2&sn=deadbeef",
    });
  });

  it("uses only feed discovery in rss-only mode", () => {
    expect(
      __internal.resolveDiscoveryMethods(
        {
          id: "source",
          accountName: "数字文旅观察",
          seedArticleUrl: "https://mp.weixin.qq.com/s/example",
          searchQuery: "数字文旅观察 公众号",
          rssFeedUrls: ["https://example.com/feed.xml"],
          maxArticleAgeDays: 2,
          maxArticlesPerCheck: 6,
          selectors: {},
        },
        "rss-only",
      ),
    ).toEqual(["feed"]);
  });

  it("falls back to search in hybrid mode", () => {
    expect(
      __internal.resolveDiscoveryMethods(
        {
          id: "source",
          accountName: "数字文旅观察",
          seedArticleUrl: "https://mp.weixin.qq.com/s/example",
          searchQuery: "数字文旅观察 公众号",
          rssFeedUrls: ["https://example.com/feed.xml"],
          maxArticleAgeDays: 2,
          maxArticlesPerCheck: 6,
          selectors: {},
        },
        "hybrid",
      ),
    ).toEqual(["feed", "sogou"]);
  });

  it("builds fallback search queries without duplicates when age filter is configured", () => {
    expect(
      __internal.buildSearchQueries({
        id: "source",
        accountName: "数字文旅观察",
        seedArticleUrl: "https://mp.weixin.qq.com/s/example",
        searchQuery: "数字文旅观察 公众号",
        maxArticleAgeDays: 2,
        maxArticlesPerCheck: 6,
        selectors: {},
      }, DateTime.fromISO("2026-04-08T10:00:00+08:00")),
    ).toEqual([
      "数字文旅观察 公众号",
      "数字文旅观察 公众号 2026",
      "数字文旅观察",
      "数字文旅观察 2026",
      "数字文旅观察 微信",
    ]);
  });

  it("parses absolute sogou result dates", () => {
    expect(
      __internal.parseSogouResultTimestamp(
        "上海文旅产业研究院document.write(timeConvert('1775532719'))2026-4-7",
        DateTime.fromISO("2026-04-08T10:00:00+08:00"),
      ),
    ).toBe("2026-04-07T12:00:00.000+08:00");
  });

  it("parses relative sogou result dates", () => {
    expect(
      __internal.parseSogouResultTimestamp(
        "上海文旅产业研究院document.write(timeConvert('1775532719'))1天前",
        DateTime.fromISO("2026-04-08T10:00:00+08:00"),
      ),
    ).toBe("2026-04-07T10:00:00.000+08:00");
  });

  it("treats recent search candidates as fresh", () => {
    expect(
      __internal.isSearchCandidateFresh(
        {
          url: "https://example.com/article",
          publishedAtHint: "上海文旅产业研究院document.write(timeConvert('1775532719'))1天前",
        },
        "2026-04-08",
        {
          browserProfilePath: "./data/browser-profile",
          dataDir: "./data",
          reportDir: "./reports",
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
            from: "test@example.com",
            subjectPrefix: "test",
          },
          sources: [],
        },
        {
          id: "source",
          accountName: "上海文旅产业研究院",
          seedArticleUrl: "https://mp.weixin.qq.com/s/example",
          searchQuery: "上海文旅产业研究院 2026",
          maxArticleAgeDays: 2,
          maxArticlesPerCheck: 6,
          selectors: {},
        },
      ),
    ).toBe(true);
  });

  it("filters stale search candidates before opening article pages", () => {
    expect(
      __internal.isSearchCandidateFresh(
        {
          url: "https://example.com/article",
          publishedAtHint: "上海文旅产业研究院document.write(timeConvert('1775532719'))2026-3-30",
        },
        "2026-04-08",
        {
          browserProfilePath: "./data/browser-profile",
          dataDir: "./data",
          reportDir: "./reports",
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
            from: "test@example.com",
            subjectPrefix: "test",
          },
          sources: [],
        },
        {
          id: "source",
          accountName: "上海文旅产业研究院",
          seedArticleUrl: "https://mp.weixin.qq.com/s/example",
          searchQuery: "上海文旅产业研究院 2026",
          maxArticleAgeDays: 2,
          maxArticlesPerCheck: 6,
          selectors: {},
        },
      ),
    ).toBe(false);
  });
});
