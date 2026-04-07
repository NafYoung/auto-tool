import { describe, expect, it } from "vitest";
import { __internal } from "../src/feed.js";

describe("feed discovery", () => {
  it("parses rss items into article candidates", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>文章一</title>
            <link>https://mp.weixin.qq.com/s?__biz=abc&amp;mid=1&amp;idx=1</link>
          </item>
          <item>
            <title>文章二</title>
            <guid>https://mp.weixin.qq.com/s?__biz=abc&amp;mid=2&amp;idx=1</guid>
          </item>
        </channel>
      </rss>`;

    expect(__internal.parseFeedCandidates(xml)).toEqual([
      {
        titleHint: "文章一",
        url: "https://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1",
      },
      {
        titleHint: "文章二",
        url: "https://mp.weixin.qq.com/s?__biz=abc&mid=2&idx=1",
      },
    ]);
  });

  it("parses atom entries into article candidates", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>文章三</title>
          <link rel="alternate" href="https://mp.weixin.qq.com/s?__biz=abc&amp;mid=3&amp;idx=1" />
        </entry>
      </feed>`;

    expect(__internal.parseFeedCandidates(xml)).toEqual([
      {
        titleHint: "文章三",
        url: "https://mp.weixin.qq.com/s?__biz=abc&mid=3&idx=1",
      },
    ]);
  });
});
