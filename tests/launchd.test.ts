import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("launchd installer", () => {
  it("adds an interval trigger so local fallback can catch up after sleep", () => {
    const script = readFileSync("scripts/install-launchd.sh", "utf8");

    expect(script).toContain("<key>StartCalendarInterval</key>");
    expect(script).toContain("<key>StartInterval</key>");
    expect(script).toContain("<integer>1800</integer>");
  });
});
