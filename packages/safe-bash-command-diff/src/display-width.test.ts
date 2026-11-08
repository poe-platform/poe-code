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
    ["abc\r1234\tcontents\n", "abcd\r1\tcontents\n", "abc\r1234    conten | abcd\r                 1       conten\n"],
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

for (const buffered of [false, true]) {
  for (const expand of [false, true]) {
    const indent = expand ? " ".repeat(17) : "\t\t";
    const left = expand ? "1234    conten" : "1234\tconte";
    const right = expand ? "1       conten" : "1\tconte";
    for (const prefix of ["abc", "12345678901234567890", "abc\rdef"]) {
      test(`carriage returns restore each side after clipping (buffered=${buffered}, expand=${expand}, prefix=${JSON.stringify(prefix)})`, async () => {
        const visiblePrefix = prefix.slice(0, expand ? 14 : 13);
        const result = await run("diff", ["-I", "NEVER_MATCH", "-y", ...(expand ? ["-t"] : []), "-W31", "old", "new"], {
          buffered, files: { old: `${prefix}\r1234\tcontents\n`, new: "abcd\r1\tcontents\n" },
        });
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, `${visiblePrefix}\r${left} |${expand ? " " : "\t"}abcd\r${indent}${right}\n`);
      });
    }
  }
}
