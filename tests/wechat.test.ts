import { describe, expect, it } from "vitest";
import { __internal } from "../src/wechat.js";

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
