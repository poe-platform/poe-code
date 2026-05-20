import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runVitest } from "./vitest-runner.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runVitest integration", () => {
  it("runs real vitest tests and returns per-case results", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-eval-vitest-"));
    tempRoots.push(root);

    const testsDir = path.join(root, "oracle", "tests");
    const cloneDir = path.join(root, "clone");
    const oracleDir = path.join(root, "oracle");
    await mkdir(testsDir, { recursive: true });
    await mkdir(cloneDir, { recursive: true });
    await writeFile(
      path.join(testsDir, "sample.test.ts"),
      [
        "import { describe, expect, it } from 'vitest';",
        "",
        "describe('default scorer', () => {",
        "  it('passes with env', () => {",
        "    expect(process.env.CLONE_DIR).toBeTruthy();",
        "    expect(process.env.ORACLE_DIR).toBeTruthy();",
        "  });",
        "",
        "  it('fails intentionally', () => {",
        "    expect(1).toBe(2);",
        "  });",
        "});",
        ""
      ].join("\n"),
      "utf8"
    );

    const result = await runVitest({
      testsDir,
      cloneDir,
      oracleDir,
      timeoutMs: 30_000
    });

    expect(result.passed).toBe(1);
    expect(result.total).toBe(2);
    expect(result.cases).toEqual([
      expect.objectContaining({
        name: "sample.test.ts > default scorer > passes with env",
        passed: true
      }),
      expect.objectContaining({
        name: "sample.test.ts > default scorer > fails intentionally",
        passed: false,
        message: expect.stringContaining("expected 1 to be 2")
      })
    ]);
  }, 30_000);
});
