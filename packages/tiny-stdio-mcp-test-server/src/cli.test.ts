import { execFile } from "node:child_process";
import { promisify } from "node:util";
import packageJson from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";

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
});
