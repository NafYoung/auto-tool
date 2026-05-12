import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("launchd installer", () => {
  it("adds an interval trigger so local fallback can catch up after sleep", () => {
    const script = readFileSync("scripts/install-launchd.sh", "utf8");

    expect(script).toContain("<key>StartCalendarInterval</key>");
    expect(script).toContain("<key>StartInterval</key>");
    expect(script).toContain("<integer>1800</integer>");
  });

  it("keeps launchd runtime files out of the Documents workspace", () => {
    const script = readFileSync("scripts/install-launchd.sh", "utf8");

    expect(script).toContain('LOG_DIR="${HOME}/Library/Logs/wenlv-news-digest"');
    expect(script).toContain('RUNTIME_SOURCE_CONFIG_PATH="${RUNTIME_ROOT}/source.config.json"');
    expect(script).toContain('RUNTIME_BROWSER_PROFILE_PATH="${RUNTIME_ROOT}/browser-profile"');
    expect(script).toContain('cp "${CONFIG_PATH}" "${RUNTIME_SOURCE_CONFIG_PATH}"');
    expect(script).toContain('export WENLV_SOURCE_CONFIG_PATH="${RUNTIME_SOURCE_CONFIG_PATH}"');
  });
});
