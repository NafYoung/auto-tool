import { describe, expect, it } from "vitest";
import { requireEnvVars, resolveEmailRuntime } from "../src/config.js";
import type { AppConfig } from "../src/types.js";

const config: AppConfig = {
  browserProfilePath: "/tmp/browser",
  dataDir: "/tmp/data",
  reportDir: "/tmp/reports",
  schedule: {
    timezone: "Asia/Shanghai",
    dailyReportTime: "19:00",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    temperature: 0.3,
    maxOutputTokens: 800,
  },
  email: {
    from: "digest@example.com",
    subjectPrefix: "日报",
  },
  sources: [],
};

describe("config runtime validation", () => {
  it("throws when required env vars are missing", () => {
    expect(() => requireEnvVars(["DEEPSEEK_API_KEY"], {})).toThrow("缺少环境变量");
  });

  it("resolves email runtime with MAIL_TO fallback", () => {
    const runtime = resolveEmailRuntime(config, {
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      MAIL_TO: "to@example.com",
    });

    expect(runtime.to).toBe("to@example.com");
    expect(runtime.port).toBe(465);
  });
});
