import { describe, expect, it } from "vitest";
import { cleanArticleContent, normalizeWeChatUrl } from "../src/pipeline.js";

describe("pipeline helpers", () => {
  it("removes common WeChat noise while keeping正文", () => {
    const raw = `
      点击蓝字关注我们
      这是正文第一段。
      这是正文第二段。
      微信扫一扫
      免责声明：本文仅供参考
    `;

    expect(cleanArticleContent(raw)).toBe("这是正文第一段。\n这是正文第二段。");
  });

  it("normalizes tracking parameters in article url", () => {
    const normalized = normalizeWeChatUrl(
      "https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1&sn=xyz&scene=1&clicktime=123",
    );

    expect(normalized).toBe("https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1&sn=xyz");
  });
});
