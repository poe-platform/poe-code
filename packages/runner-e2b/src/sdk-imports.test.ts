import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("E2B SDK import boundary", () => {
  it("keeps e2b SDK imports isolated to sdk.ts", async () => {
    const srcDir = path.resolve("packages/runner-e2b/src");
    const files = ["factory.ts", "index.ts", "job-handle.ts", "opened-env.ts", "template-build.ts"];

    for (const file of files) {
      const source = await readFile(path.join(srcDir, file), "utf8");
      expect(source).not.toContain('from "e2b"');
      expect(source).not.toContain("from 'e2b'");
    }
  });
});
