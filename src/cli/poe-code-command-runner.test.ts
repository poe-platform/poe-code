import { describe, it, expect, vi } from "vitest";
import { createCliContainer } from "./container.js";
import { createHomeFs, storeTestApiKey } from "../../tests/test-helpers.js";

const cwd = "/repo";
const homeDir = "/home/test";

describe("poe-code command runner", () => {
  it("dispatches `poe-code wrap` to the isolated agent binary", async () => {
    const fs = createHomeFs(homeDir);
    const baseRunner = vi.fn(async () => ({
      stdout: "OK\n",
      stderr: "",
      exitCode: 0
    }));
    const container = createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd, homeDir, variables: {} },
      logger: () => {},
      commandRunner: baseRunner
    });

    await storeTestApiKey(fs, homeDir, "sk-test");

    const result = await container.commandRunner("poe-code", [
      "wrap",
      "claude-code",
      "-p",
      "Say hi"
    ]);

    expect(baseRunner).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p", "Say hi", "--settings"]),
      expect.objectContaining({
        env: expect.objectContaining({
          POE_API_KEY: "sk-test"
        })
      })
    );

    // Verify --settings contains apiKeyHelper and env.ANTHROPIC_BASE_URL
    const callArgs = baseRunner.mock.calls[0][1] as string[];
    const settingsIdx = callArgs.indexOf("--settings");
    expect(settingsIdx).toBeGreaterThan(-1);
    const settingsJson = JSON.parse(callArgs[settingsIdx + 1]);
    expect(settingsJson).toEqual({
      apiKeyHelper: "echo $POE_API_KEY",
      env: { ANTHROPIC_BASE_URL: "https://api.poe.com" }
    });

    expect(result).toEqual({ stdout: "OK\n", stderr: "", exitCode: 0 });
  });
});
