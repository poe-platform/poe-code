import assert from "node:assert/strict";
import test from "node:test";
import { native, run } from "./helpers.js";

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
  test(`normal native golden: ${fixture.name}, ${JSON.stringify(flags)}`, async () => {
    const args = [...flags, "-L", "OLD", "-L", "NEW", "old", "new"];
    const files = { old: fixture.old, new: fixture.next };
    const expected = { exitCode: fixture.old === fixture.next ? 0 : 1, stdout: fixture.expected, stderr: "" };
    const oracle = await native("diff", args, files);
    assert.deepEqual({ exitCode: oracle.exitCode, stdout: oracle.stdout, stderr: oracle.stderr }, expected);
    const actual = await run("diff", args, { files });
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
  });
}

for (const flags of [["-u", "--normal"], ["--normal", "-u"], ["--normal", "-U0"], ["--unified=1", "--normal"]]) {
  test(`normal format conflict matches native status: ${JSON.stringify(flags)}`, async () => {
    const args = [...flags, "old", "new"];
    const files = { old: "old\n", new: "new\n" };
    const expected = await native("diff", args, files);
    assert.equal(expected.exitCode, 2);
    const actual = await run("diff", args, { files });
    assert.equal(actual.exitCode, expected.exitCode);
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
  test(`context native golden: ${fixture.name}`, async () => {
    const args = ["-c", "-L", "OLD", "-L", "NEW", "old", "new"];
    const files = { old: fixture.old, new: fixture.next };
    const expected = { exitCode: 1, stdout: `*** OLD\n--- NEW\n***************\n${fixture.expected}`, stderr: "" };
    for (const actual of [await native("diff", args, files), await run("diff", args, { files })]) {
      assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
    }
  });
}

for (const fixture of normalCases) for (const flags of [["-c"], ["--context"], ["-C0"], ["-C", "1"], ["--context=9"]]) {
  test(`context native exact bytes: ${fixture.name}, ${JSON.stringify(flags)}`, async () => {
    const args = [...flags, "-L", "OLD", "-L", "NEW", "old", "new"];
    const files = { old: fixture.old, new: fixture.next };
    const expected = await native("diff", args, files);
    assert.equal(expected.exitCode, fixture.old === fixture.next ? 0 : 1);
    assert.equal(expected.stderr, "");
    const actual = await run("diff", args, { files });
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { exitCode: expected.exitCode, stdout: expected.stdout, stderr: "" });
  });
}

for (const gap of [0, 1, 2, 3, 5, 6, 7]) for (const context of [0, 1, 3]) {
  test(`context hunk merge boundary: gap ${gap}, context ${context}`, async () => {
    const middle = Array.from({ length: gap }, (_, index) => `line ${index}\n`).join("");
    const files = { old: `a\n${middle}z\n`, new: `A\n${middle}Z\n` };
    const args = [`-C${context}`, "-L", "OLD", "-L", "NEW", "old", "new"];
    const expected = await native("diff", args, files);
    const actual = await run("diff", args, { files });
    assert.equal(actual.exitCode, 1, actual.stderr);
    assert.equal(actual.stdout, expected.stdout);
    assert.equal((actual.stdout.match(/^\*{15}$/gmu) ?? []).length, gap <= 2 * context ? 1 : 2);
  });
}

for (const flags of [["-C0", "-c"], ["-C0", "--context"], ["--context=1", "-rc"], ["-C", "0", "-crc", "--context"], ["-c", "-C0"], ["--context", "--context=1"], ["-C0", "-c", "-C1", "--context"]]) {
  test(`context explicit count survives default selector: ${JSON.stringify(flags)}`, async () => {
    const files = { old: "a\nb\nc\nd\ne\nf\ng\n", new: "A\nb\nc\nd\ne\nf\nG\n" };
    const args = [...flags, "-L", "OLD", "-L", "NEW", "old", "new"];
    const expected = await native("diff", args, files);
    const actual = await run("diff", args, { files });
    assert.equal(expected.exitCode, 1);
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { exitCode: 1, stdout: expected.stdout, stderr: "" });
  });
}

for (const flags of [["-c", "-u"], ["-u", "-c"], ["--normal", "-c"], ["-C0", "--normal"], ["-C0", "-U0"], ["-uc"], ["-cu"], ["--context", "--unified"]]) {
  test(`context format conflict: ${JSON.stringify(flags)}`, async () => {
    const args = [...flags, "old", "new"];
    const files = { old: "old\n", new: "new\n" };
    assert.equal((await native("diff", args, files)).exitCode, 2);
    const actual = await run("diff", args, { files });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
    assert.match(actual.stderr, /conflicting output format/u);
  });
}

for (const args of [["-C"], ["-C-1", "old", "new"], ["--context=", "old", "new"], ["--context=1.5", "old", "new"], ["-C9007199254740992", "old", "new"]]) {
  test(`context validates counts: ${JSON.stringify(args)}`, async () => {
    const actual = await run("diff", args, { files: { old: "old", new: "new" } });
    assert.equal(actual.exitCode, 2);
    assert.equal(actual.stdout, "");
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
