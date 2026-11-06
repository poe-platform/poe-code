import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.test-support.js";

for (const buffered of [false, true]) {
  test(`tab expansion uses display cells (buffered=${buffered})`, async () => {
    const result = await run("diff", ["-I", "NEVER_MATCH", "-t", "old", "new"], {
      buffered, files: { old: "日本語\tA\n", new: "価格表\tB\n" },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "1c1\n< 日本語  A\n---\n> 価格表  B\n");
  });

  test(`ignore-tab-expansion uses the same display cells (buffered=${buffered})`, async () => {
    const result = await run("diff", ["-I", "NEVER_MATCH", "-E", "old", "new"], {
      buffered, files: { old: "日本語\tA\ncafe\u0301\tB\n", new: "日本語  A\ncafe\u0301    B\n" },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
  });

  for (const [old, next, expected] of [
    ["cafe\u0301\tRun `zip`\n", "re\u0301sume\u0301\tRun `zip`\n", "cafe\u0301    Run `z | re\u0301sume\u0301  Run `z\n"],
    ["日本語\tABCDEFG\n", "価格表\tabcdefg\n", "日本語  ABCDEF | 価格表  abcdef\n"],
    ["1234567890123界\n", "1234567890123語\n", "1234567890123  | 1234567890123\n"],
    ["abc\tABCDEFG\n", "def\tabcdefg\n", "abc     ABCDEF | def     abcdef\n"],
  ]) {
    test(`side-by-side clips display cells ${JSON.stringify(old)} (buffered=${buffered})`, async () => {
      const result = await run("diff", ["-I", "NEVER_MATCH", "-y", "-t", "-W31", "old", "new"], {
        buffered, files: { old: old!, new: next! },
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, expected);
    });
  }
}
