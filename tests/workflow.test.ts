import { describe, expect, it } from "vitest";
import { ensureNoSourceFailures } from "../src/workflow.js";
import type { ReportFailure } from "../src/types.js";

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
