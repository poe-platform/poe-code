import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scriptUrl = new URL(
  "../../scripts/workflows/resolve-model-issue.cjs",
  import.meta.url
).href;

describe("resolve model issue workflow script", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      GITHUB_REPOSITORY: "poe-platform/poe-code",
      GITHUB_TOKEN: "token",
      ISSUE_NUMBER: "123"
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("builds an issue prompt and spawns the resolver agent", async () => {
    const spawnSpy = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "Generated prompt",
        stderr: ""
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: "",
        stderr: ""
      });

    const module = await import(scriptUrl);
    module.runWithSpawn(spawnSpy);

    expect(spawnSpy).toHaveBeenNthCalledWith(
      1,
      "node",
      ["scripts/workflows/build-issue-prompt.cjs"],
      expect.objectContaining({
        encoding: "utf8"
      })
    );
    expect(spawnSpy).toHaveBeenNthCalledWith(
      2,
      "poe-code",
      ["spawn", "claude-code", "Generated prompt"],
      expect.objectContaining({
        encoding: "utf8"
      })
    );
  });
});
