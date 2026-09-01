import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.js";

const marker = "\n\\ No newline at end of file\n";
const normalCases = [
  { name: "equal", old: "same\n", next: "same\n", expected: "" },
  { name: "both empty", old: "", next: "", expected: "" },
  { name: "replace", old: "a\nb\nc\n", next: "a\nB\nc\n", expected: "2c2\n< b\n---\n> B\n" },
  { name: "replace ranges", old: "a\nb\nc\nd\n", next: "a\nB\nC\nD\nd\n", expected: "2,3c2,4\n< b\n< c\n---\n> B\n> C\n> D\n" },
  { name: "prepend", old: "tail\n", next: "first\nsecond\ntail\n", expected: "0a1,2\n> first\n> second\n" },
  { name: "insert", old: "a\nb\n", next: "a\nx\nb\n", expected: "1a2\n> x\n" },
  { name: "append", old: "a\n", next: "a\nb\nc\n", expected: "1a2,3\n> b\n> c\n" },
  { name: "delete first", old: "first\nsecond\ntail\n", next: "tail\n", expected: "1,2d0\n< first\n< second\n" },
  { name: "delete middle", old: "a\nx\nb\n", next: "a\nb\n", expected: "2d1\n< x\n" },
  { name: "delete last", old: "a\nb\nc\n", next: "a\n", expected: "2,3d1\n< b\n< c\n" },
  { name: "empty old", old: "", next: "one\ntwo\n", expected: "0a1,2\n> one\n> two\n" },
  { name: "empty new", old: "one\ntwo\n", next: "", expected: "1,2d0\n< one\n< two\n" },
  { name: "empty old incomplete", old: "", next: "one", expected: `0a1\n> one${marker}` },
  { name: "empty new incomplete", old: "one", next: "", expected: `1d0\n< one${marker}` },
  { name: "incomplete old", old: "one", next: "one\n", expected: `1c1\n< one${marker}---\n> one\n` },
  { name: "incomplete new", old: "one\n", next: "one", expected: `1c1\n< one\n---\n> one${marker}` },
  { name: "incomplete both", old: "old", next: "new", expected: `1c1\n< old${marker}---\n> new${marker}` },
  { name: "multiple hunks", old: "a\nb\nc\nd\n", next: "A\nb\nC\nx\nd\n", expected: "1c1\n< a\n---\n> A\n3c3,4\n< c\n---\n> C\n> x\n" },
  { name: "original UTF-8 CRLF and blanks", old: "\ufeffcafé\r\n\n", next: "雪\r\n \n", expected: "1,2c1,2\n< \ufeffcafé\r\n< \n---\n> 雪\r\n>  \n" },
];

for (const fixture of normalCases) for (const flags of [[], ["--normal"], ["--normal", "--normal"]]) {
  test(`normal static golden: ${fixture.name}, ${JSON.stringify(flags)}`, async () => {
    const args = [...flags, "-L", "OLD", "-L", "NEW", "old", "new"];
    const files = { old: fixture.old, new: fixture.next };
    const expected = { exitCode: fixture.old === fixture.next ? 0 : 1, stdout: fixture.expected, stderr: "" };
    const actual = await run("diff", args, { files });
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
  });
}

for (const flags of [["-u", "--normal"], ["--normal", "-u"], ["--normal", "-U0"], ["--unified=1", "--normal"]]) {
  test(`normal format conflict status: ${JSON.stringify(flags)}`, async () => {
    const args = [...flags, "old", "new"];
    const files = { old: "old\n", new: "new\n" };
    const actual = await run("diff", args, { files });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
    assert.match(actual.stderr, /conflicting output format/u);
  });
}

for (const options of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }, { maxLines: 1 }, { maxMatrixCells: 1 }, { maxWork: 1 }, { maxHunks: 1 }]) {
  test(`normal output is atomic on budget failure: ${JSON.stringify(options)}`, async () => {
    const result = await run("diff", ["old", "new"], { files: { old: "a\nb\nc\n", new: "A\nb\nC\n" }, options });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /limit|maxBytes/u);
  });
}

test("normal cancellation interrupts comparison without output", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel normal comparison");
  let writes = 0;
  const pending = run("diff", ["old", "new"], {
    files: { old: "old\n".repeat(800), new: "new\n".repeat(800) }, signal: controller.signal,
    stdout: { async write() { writes++; } },
  });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(pending, error => error === reason); }
  finally { clearTimeout(timer); }
  assert.equal(writes, 0);
});

test("normal stdin, missing-file and brief label behavior", async () => {
  const stdin = await run("diff", ["-", "new"], { input: "old", files: { new: "new" } });
  assert.equal(stdin.stdout, `1c1\n< old${marker}---\n> new${marker}`);
  const missing = await run("diff", ["-N", "old", "new"], { files: { new: "new\n" } });
  assert.equal(missing.stdout, "0a1\n> new\n");
  const brief = await run("diff", ["--normal", "-q", "-L", "BEFORE", "-L", "AFTER", "old", "new"], { files: { old: "old\n", new: "new\n" } });
  assert.equal(brief.stdout, "Files BEFORE and AFTER differ\n");
});

const contextCases = [
  { name: "replacement", old: "a\nb\nc\n", next: "a\nB\nc\n", expected: "*** 1,3 ****\n  a\n! b\n  c\n--- 1,3 ----\n  a\n! B\n  c\n" },
  { name: "pure insertion omits old body", old: "a\nb\n", next: "a\nx\nb\n", expected: "*** 1,2 ****\n--- 1,3 ----\n  a\n+ x\n  b\n" },
  { name: "pure deletion omits new body", old: "a\nx\nb\n", next: "a\nb\n", expected: "*** 1,3 ****\n  a\n- x\n  b\n--- 1,2 ----\n" },
  { name: "empty old incomplete", old: "", next: "x", expected: `*** 0 ****\n--- 1 ----\n+ x${marker}` },
  { name: "empty new incomplete", old: "x", next: "", expected: `*** 1 ****\n- x${marker}--- 0 ----\n` },
  { name: "incomplete both", old: "old", next: "new", expected: `*** 1 ****\n! old${marker}--- 1 ----\n! new${marker}` },
  { name: "incomplete context", old: "old\ntail", next: "new\ntail", expected: `*** 1,2 ****\n! old\n  tail${marker}--- 1,2 ----\n! new\n  tail${marker}` },
  { name: "separated delete and insert", old: "a\nold\nb\nc\n", next: "a\nb\nnew\nc\n", expected: "*** 1,4 ****\n  a\n- old\n  b\n  c\n--- 1,4 ----\n  a\n  b\n+ new\n  c\n" },
];

for (const fixture of contextCases) {
  test(`context static golden: ${fixture.name}`, async () => {
    const args = ["-c", "-L", "OLD", "-L", "NEW", "old", "new"];
    const files = { old: fixture.old, new: fixture.next };
    const expected = { exitCode: 1, stdout: `*** OLD\n--- NEW\n***************\n${fixture.expected}`, stderr: "" };
    for (const actual of [await run("diff", args, { files })]) {
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
    }
  });
}

for (const fixture of normalCases) for (const flags of [["-c"], ["--context"], ["-C0"], ["-C", "1"], ["--context=9"]]) {
  test(`context output status: ${fixture.name}, ${JSON.stringify(flags)}`, async () => {
    const args = [...flags, "-L", "OLD", "-L", "NEW", "old", "new"];
    const files = { old: fixture.old, new: fixture.next };
    const actual = await run("diff", args, { files });
    assert.equal(actual.exitCode, fixture.old === fixture.next ? 0 : 1);
    assert.equal(actual.stderr, "");
  });
}

for (const gap of [0, 1, 2, 3, 5, 6, 7]) for (const context of [0, 1, 3]) {
  test(`context hunk merge boundary: gap ${gap}, context ${context}`, async () => {
    const middle = Array.from({ length: gap }, (_, index) => `line ${index}\n`).join("");
    const files = { old: `a\n${middle}z\n`, new: `A\n${middle}Z\n` };
    const args = [`-C${context}`, "-L", "OLD", "-L", "NEW", "old", "new"];
    const actual = await run("diff", args, { files });
    assert.equal(actual.exitCode, 1, actual.stderr);
    assert.equal((actual.stdout.match(/^\*{15}$/gmu) ?? []).length, gap <= 2 * context ? 1 : 2);
  });
}

for (const flags of [["-C0", "-c"], ["-C0", "--context"], ["--context=1", "-rc"], ["-C", "0", "-crc", "--context"], ["-c", "-C0"], ["--context", "--context=1"], ["-C0", "-c", "-C1", "--context"]]) {
  test(`GNU context selectors retain maximum requested width: ${JSON.stringify(flags)}`, async () => {
    const files = { old: "a\nb\nc\nd\ne\nf\ng\n", new: "A\nb\nc\nd\ne\nf\nG\n" };
    const args = [...flags, "-L", "OLD", "-L", "NEW", "old", "new"];
    const expected = { exitCode: 1, stdout: "*** OLD\n--- NEW\n***************\n*** 1,7 ****\n! a\n  b\n  c\n  d\n  e\n  f\n! g\n--- 1,7 ----\n! A\n  b\n  c\n  d\n  e\n  f\n! G\n", stderr: "" };
    for (const actual of [await run("diff", args, { files })]) {
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
    }
  });
}

for (const flags of [["-c", "-u"], ["-u", "-c"], ["--normal", "-c"], ["-C0", "--normal"], ["-C0", "-U0"], ["-uc"], ["-cu"], ["--context", "--unified"]]) {
  test(`context format conflict: ${JSON.stringify(flags)}`, async () => {
    const args = [...flags, "old", "new"];
    const files = { old: "old\n", new: "new\n" };
    const actual = await run("diff", args, { files });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
    assert.match(actual.stderr, /conflicting output format/u);
  });
}

for (const args of [["-C"], ["-C-1", "old", "new"], ["--context=1.5", "old", "new"]]) {
  test(`context validates counts: ${JSON.stringify(args)}`, async () => {
    const actual = await run("diff", args, { files: { old: "old", new: "new" } });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
  });
}

for (const flag of ["--context=", "-C9007199254740992"]) {
  test(`GNU context accepts count ${JSON.stringify(flag)} with exact incomplete-line output`, async () => {
    const files = { old: "old", new: "new" };
    const args = [flag, "-L", "old", "-L", "new", "old", "new"];
    const expected = { exitCode: 1, stdout: `*** old\n--- new\n***************\n*** 1 ****\n! old${marker}--- 1 ----\n! new${marker}`, stderr: "" };
    for (const actual of [await run("diff", args, { files })]) {
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
    }
  });
}

for (const options of [{ maxInputBytes: 1 }, { maxOutputBytes: 30 }, { maxLines: 1 }, { maxMatrixCells: 1 }, { maxWork: 1 }, { maxHunks: 1 }]) {
  test(`context output is atomic on budget failure: ${JSON.stringify(options)}`, async () => {
    const actual = await run("diff", ["-C0", "old", "new"], { files: { old: "a\nb\nc\n", new: "A\nb\nC\n" }, options });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
  });
}

test("context cancellation interrupts comparison without output", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel context comparison");
  let writes = 0;
  const pending = run("diff", ["-c", "old", "new"], {
    files: { old: "old\n".repeat(800), new: "new\n".repeat(800) }, signal: controller.signal,
    stdout: { async write() { writes++; } },
  });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(pending, error => error === reason); }
  finally { clearTimeout(timer); }
  assert.equal(writes, 0);
});

test("context brief labels and explicit maximum safe context count", async () => {
  const files = { old: "old\n", new: "new\n" };
  for (const flags of [["-cq"], ["-qc"], ["-C0", "--brief"], ["--brief", "--context"]]) {
    const result = await run("diff", [...flags, "-L", "BEFORE", "-L", "AFTER", "old", "new"], { files });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "Files BEFORE and AFTER differ\n");
  }
  const result = await run("diff", ["-C9007199254740991", "-L", "OLD", "-L", "NEW", "old", "new"], { files });
  assert.equal(result.stdout, "*** OLD\n--- NEW\n***************\n*** 1 ****\n! old\n--- 1 ----\n! new\n");
});

const whitespaceCases = [
  { name: "run amount", old: "a  b\n", next: "a\tb\n", change: true, all: true },
  { name: "all C-locale whitespace", old: "a \t\v\f\rb \t\v\f\r\n", next: "a b\n", change: true, all: true },
  { name: "trailing run", old: "a\t \n", next: "a\n", change: true, all: true },
  { name: "leading run amount", old: "  a\n", next: "\ta\n", change: true, all: true },
  { name: "leading run presence", old: " a\n", next: "a\n", change: false, all: true },
  { name: "internal run presence", old: "a b\n", next: "ab\n", change: false, all: true },
  { name: "spacing only blank line", old: " \t\n", next: "\n", change: true, all: true },
  { name: "CRLF", old: "a\r\nb\r\n", next: "a\nb\n", change: true, all: true },
  { name: "missing final newline", old: "a", next: "a\n", change: true, all: true },
  { name: "new missing final newline", old: "a\n", next: "a", change: true, all: true },
  { name: "blank line deletion remains significant", old: "a\n\n", next: "a\n", change: false, all: false },
  { name: "whitespace line deletion remains significant", old: "a\n \n", next: "a\n", change: false, all: false },
  { name: "line boundaries remain significant", old: "a\nb\n", next: "ab\n", change: false, all: false },
  { name: "NBSP remains significant", old: "a\u00a0b\n", next: "ab\n", change: false, all: false },
  { name: "Unicode em space remains significant", old: "a\u2003b\n", next: "ab\n", change: false, all: false },
  { name: "BOM remains significant", old: "\ufeffa\n", next: "a\n", change: false, all: false },
  { name: "case remains significant", old: "a b\n", next: "A b\n", change: false, all: false },
  { name: "original non-ASCII bytes", old: "café  雪\n", next: "café\t雪\n", change: true, all: true },
];

test("whitespace comparison policy", async () => {
  for (const fixture of whitespaceCases) for (const mode of ["change", "all"] as const) {
    const result = await run("diff", [mode === "all" ? "-w" : "-b", "old", "new"], { files: { old: fixture.old, new: fixture.next } });
    assert.equal(result.exitCode, fixture[mode] ? 0 : 1, `${fixture.name}, ${mode}: ${result.stderr}`);
    if (fixture[mode]) assert.equal(result.stdout, "");
  }
});

for (const fixture of whitespaceCases) for (const mode of ["change", "all"] as const) for (const format of ["--normal", "-u", "-c"]) {
  test(`whitespace option status: ${fixture.name}, ${mode}, ${format}`, async () => {
    const flags = mode === "all" ? ["-w", "--ignore-all-space"] : ["-b", "--ignore-space-change"];
    const files = { old: fixture.old, new: fixture.next };
    for (const flag of flags) {
      const args = [flag, format, "-L", "OLD", "-L", "NEW", "old", "new"];
      const actual = await run("diff", args, { files });
      assert.equal(actual.exitCode, fixture[mode] ? 0 : 1);
      assert.equal(actual.stderr, "");
    }
  });
}

const originalWhitespaceCases = [
  { flags: ["-w"], old: " a b \n old text\t\n x y \n", next: "ab\n new text  \nxy\n", normal: "2c2\n<  old text\t\n---\n>  new text  \n",
    unified: "@@ -1,3 +1,3 @@\n  a b \n- old text\t\n+ new text  \n  x y \n",
    context: "*** 1,3 ****\n   a b \n!  old text\t\n   x y \n--- 1,3 ----\n  ab\n!  new text  \n  xy\n" },
  { flags: ["-b"], old: " a  b \n old text\t\n x  y \n", next: "\ta\tb\n new text  \n\tx\ty\n", normal: "2c2\n<  old text\t\n---\n>  new text  \n",
    unified: "@@ -1,3 +1,3 @@\n  a  b \n- old text\t\n+ new text  \n  x  y \n",
    context: "*** 1,3 ****\n   a  b \n!  old text\t\n   x  y \n--- 1,3 ----\n  \ta\tb\n!  new text  \n  \tx\ty\n" },
];

for (const fixture of originalWhitespaceCases) for (const format of ["normal", "unified", "context"] as const) {
  test(`whitespace preserves original bodies and both context sides: ${fixture.flags[0]}, ${format}`, async () => {
    const args = [...fixture.flags, `--${format}`, "-L", "OLD", "-L", "NEW", "old", "new"];
    const files = { old: fixture.old, new: fixture.next };
    const prefix = format === "unified" ? "--- OLD\n+++ NEW\n" : format === "context" ? "*** OLD\n--- NEW\n***************\n" : "";
    const expected = { exitCode: 1, stdout: prefix + fixture[format], stderr: "" };
    for (const actual of [await run("diff", args, { files })]) {
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
    }
  });
}

for (const flags of [["-wq"], ["-qw"], ["-bq"], ["--brief", "--ignore-space-change"], ["-wcq"], ["-buq"]]) {
  test(`whitespace brief compares normalized lines and retains labels: ${JSON.stringify(flags)}`, async () => {
    const args = [...flags, "-L", "BEFORE", "-L", "AFTER", "old", "new"];
    const same = await run("diff", args, { files: { old: "a  b\n", new: "a\tb\n" } });
    assert.equal(same.exitCode, 0);
    assert.equal(same.stdout, "");
    const different = await run("diff", args, { files: { old: "a  b\n", new: "a\tc\n" } });
    assert.equal(different.exitCode, 1);
    assert.equal(different.stdout, "Files BEFORE and AFTER differ\n");
  });
}

test("whitespace comparison applies to stdin, recursive files, and missing files", async () => {
  const stdin = await run("diff", ["-b", "-", "new"], { input: "a\tb\n", files: { new: "a  b \n" } });
  assert.equal(stdin.exitCode, 0);
  assert.equal(stdin.stdout, "");
  const recursive = await run("diff", ["-rw", "left", "right"], { files: { "left/same": "a b\n", "right/same": "ab\n", "left/different": "old\n", "right/different": "new\n" } });
  assert.equal(recursive.exitCode, 1);
  assert.equal(recursive.stdout, "1c1\n< old\n---\n> new\n");
  const missing = await run("diff", ["-Nw", "old", "new"], { files: { new: " \n" } });
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.stdout, "0a1\n>  \n");
});

test("whitespace equivalence avoids unnecessary LCS allocation", async () => {
  for (const flag of ["-w", "-b"]) {
    const actual = await run("diff", [flag, "-c", "old", "new"], {
      files: { old: "a b\n".repeat(200), new: "a  b \n".repeat(200) }, options: { maxMatrixCells: 1 },
    });
    assert.equal(actual.exitCode, 0, actual.stderr);
    assert.equal(actual.stdout, "");
  }
});

for (const format of ["--normal", "-U0", "-C0"]) for (const options of [{ maxInputBytes: 1 }, { maxOutputBytes: 1 }, { maxLines: 1 }, { maxMatrixCells: 1 }, { maxWork: 1 }, { maxHunks: 1 }]) {
  test(`whitespace ${format} output is atomic on budget failure: ${JSON.stringify(options)}`, async () => {
    const actual = await run("diff", ["-w", format, "old", "new"], { files: { old: "a\nb c\nd\n", new: "A\nbc\nD\n" }, options });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
  });
}

test("normalization charges original characters even when all are ignored", async () => {
  for (const flags of [["-w"], ["-b"], ["-qw"], ["-qb"]]) {
    const actual = await run("diff", [...flags, "old", "new"], { files: { old: `${" ".repeat(10_000)}\n`, new: "\n" }, options: { maxWork: 1000 } });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
    assert.match(actual.stderr, /work limit/u);
  }
});

test("whitespace cancellation interrupts normalization without output", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel whitespace normalization");
  let writes = 0;
  const pending = run("diff", ["-wc", "old", "new"], {
    files: { old: "a b\n".repeat(10_000), new: "ab\n".repeat(10_000) }, signal: controller.signal,
    stdout: { async write() { writes++; } },
  });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(pending, error => error === reason); }
  finally { clearTimeout(timer); }
  assert.equal(writes, 0);
});

test("whitespace context preserves per-side incomplete-line markers and native parity", async () => {
  const files = { old: "old\nx y", new: "new\nxy\n" };
  const args = ["-wc", "-L", "OLD", "-L", "NEW", "old", "new"];
  const expected = `*** OLD\n--- NEW\n***************\n*** 1,2 ****\n! old\n  x y${marker}--- 1,2 ----\n! new\n  xy\n`;
  const actual = await run("diff", args, { files });
  assert.equal(actual.exitCode, 1);
  assert.equal(actual.stdout, expected);
});
