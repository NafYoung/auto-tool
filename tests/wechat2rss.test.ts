import { describe, expect, it } from "vitest";
import { __internal } from "../src/wechat2rss.js";

describe("wechat2rss helpers", () => {
  it("builds addurl api url", () => {
    expect(
      __internal.buildWechat2RssAddUrlApiUrl(
        "https://wechat2rss.example.com",
        "token-123",
        "https://mp.weixin.qq.com/s/example",
      ),
    ).toBe(
      "https://wechat2rss.example.com/addurl?k=token-123&url=https%3A%2F%2Fmp.weixin.qq.com%2Fs%2Fexample",
    );
  });

  it("parses successful addurl response", () => {
    expect(
      __internal.parseWechat2RssAddUrlResponse({
        data: "https://wechat2rss.example.com/feed/abc.xml",
      }),
    ).toBe("https://wechat2rss.example.com/feed/abc.xml");
  });

  it("throws when addurl response contains err", () => {
    expect(() =>
      __internal.parseWechat2RssAddUrlResponse({
        err: "license invalid",
      }),
    ).toThrowError("Wechat2RSS 返回错误：license invalid");
  });

  it("updates rssFeedUrls for matching source ids", () => {
    expect(
      __internal.applyWechat2RssFeedUrls(
        {
          sources: [
            {
              id: "source-a",
              accountName: "甲",
              seedArticleUrl: "https://mp.weixin.qq.com/s/a",
            },
            {
              id: "source-b",
              accountName: "乙",
              seedArticleUrl: "https://mp.weixin.qq.com/s/b",
            },
          ],
        },
        {
          "source-a": "https://wechat2rss.example.com/feed/a.xml",
        },
      ),
    ).toEqual({
      sources: [
        {
          id: "source-a",
          accountName: "甲",
          seedArticleUrl: "https://mp.weixin.qq.com/s/a",
          rssFeedUrls: ["https://wechat2rss.example.com/feed/a.xml"],
        },
        {
          id: "source-b",
          accountName: "乙",
          seedArticleUrl: "https://mp.weixin.qq.com/s/b",
        },
      ],
    });
  });
});
