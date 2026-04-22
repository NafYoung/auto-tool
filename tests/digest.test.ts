import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  getLatestDueReportDate,
  getReportDateForLateAwareDiscovery,
  isTimestampFreshForReport,
  toCronExpression,
} from "../src/digest.js";

const schedule = {
  timezone: "Asia/Shanghai",
  dailyReportTime: "19:00",
  cloudPrimarySendTime: "20:15",
  localFallbackSendTime: "20:30",
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

  it("uses the previous report date before the daily cutoff", () => {
    expect(
      getLatestDueReportDate(
        schedule,
        DateTime.fromISO("2026-04-09T18:59:59+08:00"),
      ),
    ).toBe("2026-04-08");
  });

  it("uses the current report date at or after the daily cutoff", () => {
    expect(
      getLatestDueReportDate(
        schedule,
        DateTime.fromISO("2026-04-09T19:00:00+08:00"),
      ),
    ).toBe("2026-04-09");

    expect(
      getLatestDueReportDate(
        schedule,
        DateTime.fromISO("2026-04-09T19:01:00+08:00"),
      ),
    ).toBe("2026-04-09");
  });

  it("keeps pre-cutoff articles in the same-day report during the 20:00补抓窗口", () => {
    expect(
      getReportDateForLateAwareDiscovery(
        "2026-04-09T13:22:00+08:00",
        "2026-04-09T19:15:00+08:00",
        schedule,
      ),
    ).toBe("2026-04-09");
  });

  it("moves late discoveries after the补抓窗口 into the next day", () => {
    expect(
      getReportDateForLateAwareDiscovery(
        "2026-04-09T13:22:00+08:00",
        "2026-04-09T20:01:00+08:00",
        schedule,
      ),
    ).toBe("2026-04-10");
  });

  it("schedules local unattended runs from the fallback send time, not the report cutoff", () => {
    expect(toCronExpression(schedule)).toBe("30 20 * * *");
  });
});
