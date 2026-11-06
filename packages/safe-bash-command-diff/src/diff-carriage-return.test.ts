import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.test-support.js";

for (const buffered of [false, true]) for (const format of ["normal", "context", "unified"]) {
  for (const initialTab of [false, true]) for (const expand of [false, true]) {
    test(`embedded CR markers: ${format}, buffered=${buffered}, T=${initialTab}, t=${expand}`, async () => {
      const prefix = (value: string) => initialTab ? value.trimEnd() + "\t" : value;
      const body = (value: string, before: string, after: string) => {
        const flag = prefix(value);
        return flag + before + "\r" + (expand && format !== "unified" ? flag : "")
          + after + (expand ? " ".repeat(8 - after.length) : "\t") + "contents\n";
      };
      const expected = format === "normal"
        ? "1c1\n" + body("< ", "abc", "1234") + "---\n" + body("> ", "abcd", "1")
        : format === "context"
          ? "*** OLD\n--- NEW\n***************\n*** 1 ****\n" + body("! ", "abc", "1234") + "--- 1 ----\n" + body("! ", "abcd", "1")
          : "--- OLD\n+++ NEW\n@@ -1 +1 @@\n" + body("-", "abc", "1234") + body("+", "abcd", "1");
      const result = await run("diff", [`--${format}`, ...(expand ? ["-t"] : []), ...(initialTab ? ["-T"] : []),
        "-I", "^NEVER$", "-L", "OLD", "-L", "NEW", "old", "new"], {
        buffered, files: { old: "abc\r1234\tcontents\n", new: "abcd\r1\tcontents\n" },
      });
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.stdout, expected);
    });
  }
}

for (const buffered of [false, true]) for (const length of [0, 4095, 16383]) {
  for (const suffix of ["\rX\tend\n", "\n", ""]) {
    test(`CR boundaries: buffered=${buffered}, length=${length}, suffix=${JSON.stringify(suffix)}`, async () => {
      const before = "a".repeat(length);
      const result = await run("diff", ["-t", "-I", "^NEVER$", "old", "new"], {
        buffered, files: { old: "", new: before + "\r" + suffix },
      });
      const tail = suffix === "\rX\tend\n" ? "> \r> X       end\n"
        : suffix === "\n" ? "\n" : "\n\\ No newline at end of file\n";
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.stdout, "0a1\n> " + before + "\r" + tail);
    });
  }
}
