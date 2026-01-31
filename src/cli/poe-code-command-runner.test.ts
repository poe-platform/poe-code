import { describe, it, expect, vi } from "vitest";
import { createCliContainer } from "./container.js";
import { createHomeFs } from "../../tests/test-helpers.js";

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

    await fs.mkdir(`${homeDir}/.poe-code`, { recursive: true });
    await fs.writeFile(
      `${homeDir}/.poe-code/credentials.json`,
      JSON.stringify({ apiKey: "sk-test" }),
      "utf8"
    );

    const result = await container.commandRunner("poe-code", [
      "wrap",
      "claude-code",
      "-p",
      "Say hi"
    ]);

    expect(baseRunner).toHaveBeenCalledWith(
      "claude",
      ["-p", "Say hi"],
      expect.objectContaining({
        env: expect.objectContaining({
          ANTHROPIC_API_KEY: "sk-test",
          ANTHROPIC_BASE_URL: "https://api.poe.com"
        })
      })
    );

    expect(result).toEqual({ stdout: "OK\n", stderr: "", exitCode: 0 });
  });
});
