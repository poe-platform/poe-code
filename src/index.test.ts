import { describe, it, expect } from "vitest";
import { getPoeApiKey, isCliInvocation } from "./index.js";

describe("entrypoint module", () => {
  it("re-exports getPoeApiKey", async () => {
    const previous = process.env.POE_API_KEY;
    process.env.POE_API_KEY = "sdk-test-key";

    try {
      await expect(getPoeApiKey()).resolves.toBe("sdk-test-key");
    } finally {
      if (typeof previous === "string") {
        process.env.POE_API_KEY = previous;
      } else {
        delete process.env.POE_API_KEY;
      }
    }
  });

  it("detects direct invocation path", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/app/dist/index.js"];
    expect(isCliInvocation(argv, moduleUrl, (value) => value)).toBe(true);
  });

  it("detects invocation through symlinked path", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/usr/bin/poe-code"];
    const resolver = (value: string) =>
      value === "/usr/bin/poe-code" ? "/app/dist/index.js" : value;
    expect(isCliInvocation(argv, moduleUrl, resolver)).toBe(true);
  });

  it("returns false when invoked via CJS wrapper (bin.cjs)", () => {
    const moduleUrl = "file:///app/dist/index.js";
    const argv = ["node", "/app/dist/bin.cjs"];
    expect(isCliInvocation(argv, moduleUrl, (value) => value)).toBe(false);
  });
});
