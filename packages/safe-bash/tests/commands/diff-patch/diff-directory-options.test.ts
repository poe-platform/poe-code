import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";

for (const [pattern, excluded, retained] of [
  ["[[:alpha:]]*.txt", "a.txt", "1.txt"],
  ["[]a]*", "]file", "bfile"],
  ["[!]]*", "afile", "]file"],
] as const) {
  for (const option of ["-x", "--exclude", "-X", "--exclude-from"]) {
    test(`${option} handles ${pattern}`, async () => {
      const fromFile = option === "-X" || option === "--exclude-from";
      const actual = await run("diff", ["-r", option, fromFile ? "patterns" : pattern, "left", "right"], {
        files: { patterns: pattern + "\n", [`left/${excluded}`]: "old\n", [`right/${excluded}`]: "new\n",
          [`left/${retained}`]: "old\n", [`right/${retained}`]: "new\n" },
      });
      assert.equal(actual.exitCode, 1);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout, `diff -r ${option} ${fromFile ? "patterns" : pattern} left/${retained} right/${retained}\n1c1\n< old\n---\n> new\n`);
    });
  }
}

for (const format of ["u", "c", "e", "n"]) {
  test(`directory -r${format} emits a command header`, async () => {
    const actual = await run("diff", [`-r${format}`, "left", "right"], {
      files: { "left/f": "old\n", "right/f": "new\n", "left/same": "same\n", "right/same": "same\n" },
    });
    assert.equal(actual.exitCode, 1);
    assert.equal(actual.stderr, "");
    assert.ok(actual.stdout.startsWith(`diff -r${format} left/f right/f\n`));
    assert.ok(!actual.stdout.includes("diff -r" + format + " left/same"));
  });
}

for (const fixture of [
  { flags: [], old: "same\n", next: "same\n", body: "same\t\t\t\t\t\t\t\tsame\n" },
  { flags: [], old: "", next: "", body: "" },
  { flags: ["-i"], old: "A\n", next: "a\n", body: "A\t\t\t\t\t\t\t\ta\n" },
  { flags: ["-B"], old: "a\n", next: "a\n\n", body: "a\t\t\t\t\t\t\t\ta\n\t\t\t\t\t\t\t      )\n" },
]) for (const reportSame of [false, true]) for (const suppressCommon of [false, true]) {
  test(`GNU directory side-by-side equal files: ${JSON.stringify({ fixture, reportSame, suppressCommon })}`, async () => {
    const flags = ["-ry", ...fixture.flags, ...(reportSame ? ["-s"] : []), ...(suppressCommon ? ["--suppress-common-lines"] : [])];
    const actual = await run("diff", [...flags, "left", "right"], { files: { "left/f": fixture.old, "right/f": fixture.next } });
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stderr, "");
    assert.equal(actual.stdout, (suppressCommon ? "" : `diff ${flags.join(" ")} left/f right/f\n${fixture.body}`)
      + (reportSame ? "Files left/f and right/f are identical\n" : ""));
  });
}

test("directory side-by-side labels both different and identical file sections", async () => {
  const actual = await run("diff", ["-ry", "left", "right"], {
    files: { "left/f": "old\n", "right/f": "new\n", "left/same": "same\n", "right/same": "same\n" },
  });
  assert.equal(actual.exitCode, 1);
  assert.equal(actual.stderr, "");
  assert.equal(actual.stdout, "diff -ry left/f right/f\nold\t\t\t\t\t\t\t      |\tnew\n"
    + "diff -ry left/same right/same\nsame\t\t\t\t\t\t\t\tsame\n");
});

for (const option of ["-D", "--ifdef"]) {
  for (const operands of [["left", "right"], ["left", "right/f"], ["left/f", "right"]]) {
    test(`${option} rejects directory operands ${operands.join(" ")}`, async () => {
      const actual = await run("diff", [option, "SYM", ...operands], { files: { "left/f": "old\n", "right/f": "new\n" } });
      assert.equal(actual.exitCode, 2);
      assert.equal(actual.stdout, "");
      assert.equal(actual.stderr, "diff: -D option not supported with directories\n");
    });
  }
}
