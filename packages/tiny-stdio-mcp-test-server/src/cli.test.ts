import { execFile } from "node:child_process";
import { promisify } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { getNextSpawnCount } from "./cli-support.js";

const run = promisify(execFile);

describe("tiny-stdio-mcp-test-server CLI", () => {
  it("reports the package version", async () => {
    const { stdout } = await run(process.execPath, ["--import", "tsx", "src/cli.ts", "--version"], {
      cwd: new URL("..", import.meta.url)
    });

    expect(stdout.trim()).toBe(packageJson.version);
  });

  it("rejects inherited prototype tool names", async () => {
    await expect(run(process.execPath, ["--import", "tsx", "src/cli.ts", "serve", "constructor"], {
      cwd: new URL("..", import.meta.url)
    })).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Unknown tool: constructor")
    });
  });

  it("rejects unknown tools before waiting on startup gates", async () => {
    await expect(run(process.execPath, ["--import", "tsx", "src/cli.ts", "serve", "missing"], {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        TOOLCRAFT_TEST_STARTUP_GATE_FILE: "/missing/tiny-stdio-gate",
      },
      timeout: 250,
    })).rejects.toMatchObject({
      code: 1,
      killed: false,
      stderr: expect.stringContaining("Unknown tool: missing")
    });
  });

  it("rejects malformed spawn count file contents", () => {
    expect(() => getNextSpawnCount("abc\n")).toThrow(
      "TOOLCRAFT_TEST_SPAWN_COUNT_FILE must contain a non-negative integer"
    );
  });
});
