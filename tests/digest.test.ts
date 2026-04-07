import { describe, expect, it } from "vitest";
import { getReportDateForTimestamp, getReportWindow, isTimestampInReportWindow } from "../src/digest.js";

const schedule = {
  timezone: "Asia/Shanghai",
  dailyReportTime: "19:00",
};

describe("digest window", () => {
  it("assigns articles before cutoff to same-day report", () => {
    expect(getReportDateForTimestamp("2026-04-01T18:59:00+08:00", schedule)).toBe("2026-04-01");
  });

  it("assigns articles after cutoff to next-day report", () => {
    expect(getReportDateForTimestamp("2026-04-01T19:01:00+08:00", schedule)).toBe("2026-04-02");
  });

  it("builds a 24-hour report window ending at cutoff", () => {
    expect(getReportWindow("2026-04-01", schedule)).toEqual({
      start: "2026-03-31T19:00:00.000+08:00",
      end: "2026-04-01T19:00:00.000+08:00",
    });
  });

  it("keeps timestamps inside the expected report window", () => {
    expect(isTimestampInReportWindow("2026-04-01T10:00:00+08:00", "2026-04-01", schedule)).toBe(true);
    expect(isTimestampInReportWindow("2026-04-01T20:00:00+08:00", "2026-04-01", schedule)).toBe(false);
  });
});
