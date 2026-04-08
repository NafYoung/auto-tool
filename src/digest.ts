import { DateTime } from "luxon";
import type { ScheduleConfig } from "./types.js";

interface ReportTime {
  hour: number;
  minute: number;
}

export interface ReportWindow {
  start: string;
  end: string;
}

export function parseDailyReportTime(input: string): ReportTime {
  const match = input.match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    throw new Error(`无效的日报时间配置: ${input}`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (hour > 23 || minute > 59) {
    throw new Error(`无效的日报时间配置: ${input}`);
  }

  return { hour, minute };
}

export function getCutoffForDate(date: string, schedule: ScheduleConfig): DateTime {
  const { hour, minute } = parseDailyReportTime(schedule.dailyReportTime);
  return DateTime.fromISO(date, { zone: schedule.timezone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
}

export function getReportDateForTimestamp(
  timestamp: string,
  schedule: ScheduleConfig,
): string {
  const publishedAt = DateTime.fromISO(timestamp, { zone: schedule.timezone });

  if (!publishedAt.isValid) {
    throw new Error(`无法解析发布时间: ${timestamp}`);
  }

  const cutoff = publishedAt.startOf("day").set(parseDailyReportTime(schedule.dailyReportTime));
  return (publishedAt > cutoff ? publishedAt.plus({ days: 1 }) : publishedAt).toISODate()!;
}

export function getReportWindow(reportDate: string, schedule: ScheduleConfig): ReportWindow {
  const end = getCutoffForDate(reportDate, schedule);
  const start = end.minus({ days: 1 });

  return {
    start: start.toISO()!,
    end: end.toISO()!,
  };
}

export function isTimestampInReportWindow(
  timestamp: string,
  reportDate: string,
  schedule: ScheduleConfig,
): boolean {
  const moment = DateTime.fromISO(timestamp, { zone: schedule.timezone });

  if (!moment.isValid) {
    return false;
  }

  const window = getReportWindow(reportDate, schedule);
  const start = DateTime.fromISO(window.start, { zone: schedule.timezone });
  const end = DateTime.fromISO(window.end, { zone: schedule.timezone });
  return moment > start && moment <= end;
}

export function isTimestampFreshForReport(
  timestamp: string,
  reportDate: string,
  schedule: ScheduleConfig,
  maxAgeDays: number,
): boolean {
  const moment = DateTime.fromISO(timestamp, { zone: schedule.timezone });

  if (!moment.isValid) {
    return false;
  }

  const cutoff = getCutoffForDate(reportDate, schedule);
  const freshnessStart = cutoff.minus({ days: maxAgeDays });
  return moment >= freshnessStart && moment <= cutoff;
}

export function getCurrentReportDate(
  schedule: ScheduleConfig,
  now = DateTime.now().setZone(schedule.timezone),
): string {
  return now.toISODate()!;
}

export function toCronExpression(schedule: ScheduleConfig): string {
  const { hour, minute } = parseDailyReportTime(schedule.dailyReportTime);
  return `${minute} ${hour} * * *`;
}

export function formatDisplayTime(timestamp: string, timezone: string): string {
  return DateTime.fromISO(timestamp, { zone: timezone }).toFormat("yyyy-LL-dd HH:mm");
}
