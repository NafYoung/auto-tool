import { describe, expect, it } from "vitest";
import { __internal } from "../src/wechat.js";
import type { AppConfig, WeChatSourceConfig } from "../src/types.js";

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

const source: WeChatSourceConfig = {
  id: "source-1",
  accountName: "数字文旅观察",
  seedArticleUrl: "https://mp.weixin.qq.com/s/example",
  maxArticleAgeDays: 2,
  maxArticlesPerCheck: 6,
  selectors: {},
};

describe("wechat profile url derivation", () => {
  it("falls back to bizId when profile url is missing biz value", () => {
    expect(
      __internal.sanitizeDerivedProfileUrl(
        "https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=",
        "Mzk0NzY1MjM4Nw==",
      ),
    ).toBe(
      "https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=Mzk0NzY1MjM4Nw%3D%3D#wechat_redirect",
    );
  });

  it("rejects unusable profile url without biz", () => {
    expect(__internal.isUsableProfileUrl("https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=")).toBe(false);
  });
});

describe("wechat candidate freshness", () => {
  it("filters stale RSS candidates using RFC 2822 pubDate hints", () => {
    expect(
      __internal.isSearchCandidateFresh(
        {
          url: "https://weixin.sogou.com/link?url=old",
          publishedAtHint: "Tue, 17 Mar 2026 03:31:18 GMT",
        },
        "2026-04-23",
        config,
        source,
      ),
    ).toBe(false);
  });

  it("keeps fresh RSS candidates using RFC 2822 pubDate hints", () => {
    expect(
      __internal.isSearchCandidateFresh(
        {
          url: "https://weixin.sogou.com/link?url=fresh",
          publishedAtHint: "Thu, 23 Apr 2026 03:31:18 GMT",
        },
        "2026-04-23",
        config,
        source,
      ),
    ).toBe(true);
  });
});

describe("wechat rss-only cloud safeguards", () => {
  it("identifies Sogou redirect links that should not be opened in rss-only mode", () => {
    expect(__internal.isSogouRedirectUrl("https://weixin.sogou.com/link?url=abc&type=2")).toBe(true);
    expect(__internal.isSogouRedirectUrl("https://mp.weixin.qq.com/s?__biz=abc&mid=1")).toBe(false);
  });

  it("builds an actionable skip message for Sogou redirect links", () => {
    expect(__internal.buildSogouRedirectSkipMessage(2)).toBe(
      "订阅源返回 2 个搜狗跳转链接，云端 rss-only 模式已跳过，避免触发搜狗反爬；请改用直接指向 mp.weixin.qq.com 的 feed。",
    );
  });
});
