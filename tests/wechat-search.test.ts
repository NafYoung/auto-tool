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
        maxArticlesPerCheck: 6,
        selectors: {},
      }),
    ).toEqual([
      "数字文旅观察 公众号",
      "数字文旅观察",
      "数字文旅观察 微信",
    ]);
  });

  it("matches account names loosely", () => {
    expect(__internal.isLikelySameAccount("数字 文旅观察", "数字文旅观察")).toBe(true);
    expect(__internal.isLikelySameAccount("数字文旅观察官方", "数字文旅观察")).toBe(true);
    expect(__internal.isLikelySameAccount("别的公众号", "数字文旅观察")).toBe(false);
  });
});
