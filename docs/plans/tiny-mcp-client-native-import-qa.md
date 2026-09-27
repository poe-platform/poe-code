# Tiny MCP client native import QA

1. Run the original Vitest control below independently from the repository root, with the original five-second deadline. Place the temporary fixture beside `packages/tiny-mcp-client/src/index.ts` so relative URLs remain correct.
2. Verify the clean Node process exits successfully, writes no standard output, and reports no syntax error. Keep the native `tsx` loader and source entrypoint; an import in the Vitest worker does not replace this check.
3. Run the maintained normal build and the existing MCP client unit tests to verify the built package and source API independently.
4. Store temporary evidence under `out` and remove the temporary fixture after verification.

```ts
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
```
