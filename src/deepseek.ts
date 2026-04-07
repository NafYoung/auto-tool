import OpenAI from "openai";
import { z } from "zod";
import type { DeepSeekRuntime } from "./config.js";
import type { StoredArticle } from "./types.js";

const articleSummarySchema = z.object({
  bullets: z.array(z.string().min(1)).min(3).max(5),
});

const overviewSchema = z.object({
  overview: z.string().min(1),
});

function extractJsonPayload(raw: string): unknown {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("DeepSeek 返回内容中未找到 JSON 对象。");
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

function buildClient(runtime: DeepSeekRuntime): OpenAI {
  return new OpenAI({
    apiKey: runtime.apiKey,
    baseURL: runtime.baseUrl,
  });
}

export async function summarizeArticle(
  runtime: DeepSeekRuntime,
  article: StoredArticle,
): Promise<string[]> {
  const client = buildClient(runtime);
  const response = await client.chat.completions.create({
    model: runtime.model,
    temperature: runtime.temperature,
    max_tokens: runtime.maxOutputTokens,
    messages: [
      {
        role: "system",
        content:
          "你是文旅行业情报编辑。请仅输出 JSON，不要输出额外解释。JSON 结构为 {\"bullets\":[\"...\"]}，数组长度 3 到 5，每条都要具体、避免空话。",
      },
      {
        role: "user",
        content: [
          `公众号：${article.sourceName}`,
          `标题：${article.title}`,
          `发布时间：${article.publishedAt}`,
          "请提炼对文旅行业有信息价值的重点，优先保留政策、活动、产品、数据、趋势和机构动作。",
          "",
          article.cleanedContent.slice(0, 12_000),
        ].join("\n"),
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  const parsed = articleSummarySchema.parse(extractJsonPayload(content));
  return parsed.bullets;
}

export async function summarizeOverview(
  runtime: DeepSeekRuntime,
  reportDate: string,
  articles: StoredArticle[],
): Promise<string> {
  const client = buildClient(runtime);
  const payload = articles
    .map((article) => {
      const bullets = article.summaryBullets?.map((item) => `- ${item}`).join("\n") ?? "- 摘要缺失";
      return `公众号：${article.sourceName}\n标题：${article.title}\n要点：\n${bullets}`;
    })
    .join("\n\n");

  const response = await client.chat.completions.create({
    model: runtime.model,
    temperature: runtime.temperature,
    max_tokens: runtime.maxOutputTokens,
    messages: [
      {
        role: "system",
        content:
          "你是文旅行业日报编辑。请仅输出 JSON，不要输出额外解释。JSON 结构为 {\"overview\":\"...\"}，overview 为一段 80 到 180 字的中文总览。",
      },
      {
        role: "user",
        content: `请为 ${reportDate} 的文旅公众号日报写一段总览，突出当天最值得关注的趋势。\n\n${payload}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "";
  const parsed = overviewSchema.parse(extractJsonPayload(content));
  return parsed.overview;
}
