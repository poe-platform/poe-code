import assert from "node:assert/strict";
import test from "node:test";
import { run, type Files } from "./helpers.js";

const files = { left: "a\nb\nc\nd\ne\nf\ng\n", right: "A\nb\nc\nd\ne\nf\nG\n" };
const labels = ["-L", "BEFORE", "-L", "AFTER"];
const zeroContext = "--- BEFORE\n+++ AFTER\n@@ -1 +1 @@\n-a\n+A\n@@ -7 +7 @@\n-g\n+G\n";
const oneContext = "--- BEFORE\n+++ AFTER\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -6,2 +6,2 @@\n f\n-g\n+G\n";
const defaultContext = "--- BEFORE\n+++ AFTER\n@@ -1,7 +1,7 @@\n-a\n+A\n b\n c\n d\n e\n f\n-g\n+G\n";

for (const color of ["--color", "--color=auto", "--color=never"]) {
  test(`diff accepts ${color} on its nonterminal byte sink`, async () => {
    const result = await run("diff", [color, "-u", ...labels, "left", "right"], { files });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: 1, stdout: defaultContext, stderr: "" });
  });
}

test("diff forced color preserves GNU unified output bytes", async () => {
  const result = await run("diff", ["--color=always", "-U0", ...labels, "left", "right"], { files });
  const paint = (code: number, text: string) => `\u001b[${code}m${text}\u001b[0m\n`;
  assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, {
    exitCode: 1, stderr: "",
    stdout: paint(1, "--- BEFORE") + paint(1, "+++ AFTER") + paint(36, "@@ -1 +1 @@")
      + paint(31, "-a") + paint(32, "+A") + paint(36, "@@ -7 +7 @@") + paint(31, "-g") + paint(32, "+G"),
  });
});

test("diff rejects invalid color modes", async () => {
  const result = await run("diff", ["--color=rainbow", "left", "right"], { files });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /invalid color/u);
});

for (const format of [[], ["-u"], ["-c"]]) {
  test(`diff color resets before missing-newline diagnostics: ${JSON.stringify(format)}`, async () => {
    const result = await run("diff", ["--color=always", ...format, ...labels, "left", "right"], { files: { left: "old", right: "new" } });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.match(result.stdout, /old\u001b\[0m\n\\ No newline at end of file\n/u);
    assert.match(result.stdout, /new\u001b\[0m\n\\ No newline at end of file\n/u);
  });
}

test("diff side-by-side colors an inserted row including its newline", async () => {
  const result = await run("diff", ["--color=always", "-y", "left", "right"], { files: { left: "", right: "new\n" } });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.match(result.stdout, /^\u001b\[32m.*>.*new\n\u001b\[0m$/u);
});

test("diff color modes use the last mode and account for escape bytes", async () => {
  const plain = await run("diff", ["--color=always", "--color=never", "-u", ...labels, "left", "right"], { files });
  assert.equal(plain.stdout, defaultContext);
  const limited = await run("diff", ["--color=always", "-u", ...labels, "left", "right"], {
    files, options: { maxOutputBytes: Buffer.byteLength(defaultContext) },
  });
  assert.equal(limited.exitCode, 2);
  assert.equal(limited.stdout, "");
  assert.match(limited.stderr, /output byte limit/u);
});

const contextCases = [
  { flags: ["-U0", "-u"], expected: zeroContext },
  { flags: ["-U0", "--unified"], expected: zeroContext },
  { flags: ["--unified=1", "-ru"], expected: oneContext },
  { flags: ["-U", "0", "-uru", "--unified"], expected: zeroContext },
  { flags: ["-u", "-U0"], expected: zeroContext },
  { flags: ["--unified", "--unified=1"], expected: oneContext },
  { flags: ["-U0", "-u", "-U0", "--unified"], expected: zeroContext },
  { flags: ["-U0"], expected: zeroContext },
  { flags: ["--unified=1"], expected: oneContext },
  { flags: [], expected: "1c1\n< a\n---\n> A\n7c7\n< g\n---\n> G\n" },
  { flags: ["-u"], expected: defaultContext },
  { flags: ["--unified"], expected: defaultContext },
  { flags: ["-ru"], expected: defaultContext },
];

for (const fixture of contextCases) {
  test(`diff context regression: ${JSON.stringify(fixture.flags)}`, async () => {
    const result = await run("diff", [...fixture.flags, ...labels, "left", "right"], { files });
    assert.deepEqual(
      { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: 1, stdout: fixture.expected, stderr: "" },
    );
  });
}

for (const flags of [["-U3", "-U1"], ["-U1", "-U3"], ["-U0", "-u", "-U1"], ["-C3", "--context=0"]]) {
  test(`diff rejects conflicting explicit widths: ${JSON.stringify(flags)}`, async () => {
    const result = await run("diff", [...flags, ...labels, "left", "right"], { files });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /conflicting output style options/u);
  });
}

const briefInputs: { name: string; flags: string[]; files: Files }[] = [
  { name: "both files", flags: ["-q"], files: { left: "old\n", right: "new\n" } },
  { name: "missing left", flags: ["-qN"], files: { right: "new\n" } },
  { name: "missing right", flags: ["--brief", "--new-file"], files: { left: "old\n" } },
];
const briefLabels = [
  { flags: [], expected: "Files left and right differ\n" },
  { flags: ["-L", "BEFORE"], expected: "Files BEFORE and right differ\n" },
  { flags: labels, expected: "Files BEFORE and AFTER differ\n" },
  { flags: ["--label=before name", "--label", "after name"], expected: "Files before name and after name differ\n" },
];

for (const fixture of briefInputs) for (const label of briefLabels) {
  test(`diff brief label regression: ${fixture.name}, ${JSON.stringify(label.flags)}`, async () => {
    const result = await run("diff", [...fixture.flags, ...label.flags, "left", "right"], { files: fixture.files });
    assert.deepEqual(
      { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: 1, stdout: label.expected, stderr: "" },
    );
  });
}

const identicalInputs: { name: string; files: Files }[] = [
  { name: "identical files", files: { left: "same\n", right: "same\n" } },
  { name: "missing left and empty right", files: { right: "" } },
  { name: "empty left and missing right", files: { left: "" } },
];

for (const fixture of [
  { flags: ["-wC0", "-c"], expected: "*** OLD\n--- NEW\n***************\n*** 2 ****\n! old\n--- 2 ----\n! new\n" },
  { flags: ["-bU0", "-uw"], expected: "--- OLD\n+++ NEW\n@@ -2 +2 @@\n-old\n+new\n" },
]) {
  test(`explicit-count regression with whitespace: ${JSON.stringify(fixture.flags)}`, async () => {
    const args = [...fixture.flags, "-L", "OLD", "-L", "NEW", "old", "new"];
    const inputs = { old: "a b\nold\n", new: "ab\nnew\n" };
    const actual = await run("diff", args, { files: inputs });
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr },
      { exitCode: 1, stdout: fixture.expected, stderr: "" });
  });
}

for (const fixture of identicalInputs) {
  test(`diff brief labels remain silent: ${fixture.name}`, async () => {
    const result = await run("diff", ["-qN", ...labels, "left", "right"], { files: fixture.files });
    assert.deepEqual(
      { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
      { exitCode: 0, stdout: "", stderr: "" },
    );
  });
}

test("patch suffixFuzz multi-hunk cursor, -l trailing whitespace, --posix -E, and diff empty -L label", async () => {
  const multiPatch = "--- multi.txt\n+++ multi.txt\n@@ -1,5 +1,5 @@\n a1\n-old1\n+new1\n t1\n t2\n t3\n@@ -7,3 +7,3 @@\n h2_ctx1\n h2_ctx2\n-old2\n+new2\n";
  const r1 = await run("patch", [], { files: { "multi.txt": "a1\nold1\nt1\nt2\nh2_ctx1\nh2_ctx2\nold2\n" }, input: multiPatch });
  assert.equal(r1.exitCode, 0, r1.stderr);
  assert.equal(Buffer.from(await r1.fs.readFile("/work/multi.txt")).toString("utf8"), "a1\nnew1\nt1\nt2\nh2_ctx1\nh2_ctx2\nnew2\n");

  const wsPatch = "--- ws.txt\n+++ ws.txt\n@@ -1,2 +1,2 @@\n-alpha\n+ALPHA\n beta\n";
  const r2 = await run("patch", ["-l"], { files: { "ws.txt": "alpha   \nbeta\n" }, input: wsPatch });
  assert.equal(r2.exitCode, 0, r2.stderr);
  assert.equal(Buffer.from(await r2.fs.readFile("/work/ws.txt")).toString("utf8"), "ALPHA\nbeta\n");

  const emptyPatch = "--- emptyme.txt\n+++ emptyme.txt\n@@ -1 +0,0 @@\n-bye\n";
  const r3 = await run("patch", ["--posix", "-E"], { files: { "emptyme.txt": "bye\n" }, input: emptyPatch });
  assert.equal(r3.exitCode, 0, r3.stderr);
  await assert.rejects(() => r3.fs.stat("/work/emptyme.txt"));

  for (const labelFlags of [["-L", "", "-L", ""], ["--label=", "--label="], ["--label", "", "--label", ""]]) {
    const r4 = await run("diff", ["-u", ...labelFlags, "left", "right"], { files: { left: "a\n", right: "b\n" } });
    assert.equal(r4.exitCode, 1, r4.stderr);
    assert.equal(r4.stdout, "--- \n+++ \n@@ -1 +1 @@\n-a\n+b\n");
  }
});
