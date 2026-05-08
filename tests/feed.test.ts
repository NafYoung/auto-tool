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
            <pubDate>Tue, 17 Mar 2026 03:31:18 GMT</pubDate>
          </item>
          <item>
            <title>文章二</title>
            <guid>https://mp.weixin.qq.com/s?__biz=abc&amp;mid=2&amp;idx=1</guid>
          </item>
        </channel>
      </rss>`;

    expect(__internal.parseFeedCandidates(xml)).toEqual([
      {
        publishedAtHint: "Tue, 17 Mar 2026 03:31:18 GMT",
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

  it("extracts readable full text and author hints from feed content", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <item>
            <title>文旅新动态</title>
            <link>https://mp.weixin.qq.com/s?__biz=abc&amp;mid=4&amp;idx=1</link>
            <author>数字文旅观察</author>
            <pubDate>Fri, 08 May 2026 03:30:00 GMT</pubDate>
            <content:encoded><![CDATA[
              <div id="js_content">
                <p>第一段正文内容足够长，用来模拟全文 RSS 中直接携带的公众号正文。</p>
                <p>第二段继续补充文旅行业信息，避免被当成过短内容。</p>
              </div>
            ]]></content:encoded>
          </item>
        </channel>
      </rss>`;

    expect(__internal.parseFeedCandidates(xml)).toEqual([
      {
        accountNameHint: "数字文旅观察",
        contentHint: "第一段正文内容足够长，用来模拟全文 RSS 中直接携带的公众号正文。\n第二段继续补充文旅行业信息，避免被当成过短内容。",
        publishedAtHint: "Fri, 08 May 2026 03:30:00 GMT",
        titleHint: "文旅新动态",
        url: "https://mp.weixin.qq.com/s?__biz=abc&mid=4&idx=1",
      },
    ]);
  });
});
