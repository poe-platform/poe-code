import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";

// GNU diffutils 3.10: an ignored block after a change joins its hunk only
// inside the trailing context; preceding ignored blocks use the merge distance.
for (const format of ["u", "c"] as const) for (const ignore of ["pattern", "blank"] as const) {
  for (const gap of [2, 3, 5, 6, 7]) {
    test(`ignored ${ignore} after a real change: -${format}, gap ${gap}`, async () => {
      const middle = Array.from({ length: gap }, (_, index) => `${index + 2}\n`);
      const ignoredOld = ignore === "pattern" ? "# old\n" : "";
      const ignoredNew = ignore === "pattern" ? "# new\n" : "\n";
      const actual = await run("diff", [`-${format}`, ...(ignore === "pattern" ? ["-I", "^#"] : ["-B"]), "-L", "OLD", "-L", "NEW", "old", "new"], {
        files: { old: `old\n${middle.join("")}${ignoredOld}tail\n`, new: `new\n${middle.join("")}${ignoredNew}tail\n` },
      });
      const included = gap < 3;
      const context = middle.slice(0, 3).map(line => ` ${line}`).join("");
      const oldCount = included ? 1 + gap + Number(ignore === "pattern") + 1 : 4;
      const newCount = included ? gap + 3 : 4;
      const unified = `@@ -1,${oldCount} +1,${newCount} @@\n-old\n+new\n${context}`
        + (included ? (ignoredOld ? `-${ignoredOld}` : "") + `+${ignoredNew} tail\n` : "");
      const contextLines = middle.slice(0, 3).map(line => `  ${line}`).join("");
      const contextual = `***************\n*** 1,${oldCount} ****\n! old\n${contextLines}`
        + (included ? (ignoredOld ? `! ${ignoredOld}` : "") + "  tail\n" : "")
        + `--- 1,${newCount} ----\n! new\n${contextLines}`
        + (included ? `${ignore === "pattern" ? "!" : "+"} ${ignoredNew}  tail\n` : "");
      assert.equal(actual.exitCode, 1, actual.stderr);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout, format === "u" ? `--- OLD\n+++ NEW\n${unified}` : `*** OLD\n--- NEW\n${contextual}`);
    });
  }
}

for (const format of ["u", "c"] as const) {
  test(`separate -${format} hunks retain overlapping context around an ignored block`, async () => {
    const actual = await run("diff", [`-${format}`, "-I", "^#", "-L", "OLD", "-L", "NEW", "old", "new"], {
      files: { old: "old\n2\n3\n4\n# old\n6\n7\n8\nend\n", new: "new\n2\n3\n4\n# new\n6\n7\n8\nEND\n" },
    });
    assert.equal(actual.exitCode, 1, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdout, format === "u"
      ? "--- OLD\n+++ NEW\n@@ -1,4 +1,4 @@\n-old\n+new\n 2\n 3\n 4\n@@ -2,8 +2,8 @@\n 2\n 3\n 4\n-# old\n+# new\n 6\n 7\n 8\n-end\n+END\n"
      : "*** OLD\n--- NEW\n***************\n*** 1,4 ****\n! old\n  2\n  3\n  4\n--- 1,4 ----\n! new\n  2\n  3\n  4\n***************\n*** 2,9 ****\n  2\n  3\n  4\n! # old\n  6\n  7\n  8\n! end\n--- 2,9 ----\n  2\n  3\n  4\n! # new\n  6\n  7\n  8\n! END\n");
  });

  test(`GNU retains a leading ignored block inside the -${format} merge distance`, async () => {
    const actual = await run("diff", [`-${format}`, "-I", "^#", "-L", "OLD", "-L", "NEW", "old", "new"], {
      files: { old: "# old\n2\n3\n4\n5\n6\nold\n", new: "# new\n2\n3\n4\n5\n6\nnew\n" },
    });
    assert.equal(actual.exitCode, 1, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdout, format === "u"
      ? "--- OLD\n+++ NEW\n@@ -1,7 +1,7 @@\n-# old\n+# new\n 2\n 3\n 4\n 5\n 6\n-old\n+new\n"
      : "*** OLD\n--- NEW\n***************\n*** 1,7 ****\n! # old\n  2\n  3\n  4\n  5\n  6\n! old\n--- 1,7 ----\n! # new\n  2\n  3\n  4\n  5\n  6\n! new\n");
  });
}
