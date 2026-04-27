import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("tiny-mcp-client runtime imports", () => {
  it("loads the source entrypoint in a clean Node process", async () => {
    const moduleUrl = pathToFileURL(new URL("./index.ts", import.meta.url).pathname).href;

    const result = await execFileAsync(process.execPath, [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(moduleUrl)});`,
      ], {
        cwd: new URL("../../..", import.meta.url),
    });

    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("SyntaxError");
  });
});
