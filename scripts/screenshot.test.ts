import { describe, it, expect } from "vitest";
import { resolveScreenshotTimeoutMs } from "./screenshot.js";

describe("resolveScreenshotTimeoutMs", () => {
  it("uses default when env is missing or invalid", () => {
    expect(resolveScreenshotTimeoutMs({})).toBe(5000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "" })).toBe(5000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "0" })).toBe(5000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "-1" })).toBe(5000);
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "nope" })).toBe(5000);
  });

  it("uses the provided timeout when valid", () => {
    expect(resolveScreenshotTimeoutMs({ POE_SCREENSHOT_TIMEOUT_MS: "12000" })).toBe(12000);
  });
});
