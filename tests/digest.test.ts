import { describe, expect, it } from "vitest";
import { isTimestampFreshForReport } from "../src/digest.js";

const schedule = {
  timezone: "Asia/Shanghai",
  dailyReportTime: "19:00",
} as const;

describe("report freshness window", () => {
  it("keeps articles published within the last two days before cutoff", () => {
    expect(
      isTimestampFreshForReport(
        "2026-04-06T20:00:00+08:00",
        "2026-04-08",
        schedule,
        2,
      ),
    ).toBe(true);
  });

  it("filters out articles older than the freshness window", () => {
    expect(
      isTimestampFreshForReport(
        "2026-04-06T18:59:59+08:00",
        "2026-04-08",
        schedule,
        2,
      ),
    ).toBe(false);
  });
});
