import assert from "node:assert/strict";
import test from "node:test";
import { contents, replacement, run } from "./helpers.js";

test("--atomic normalized sections stage dry-run and inverse-order reverse", async () => {
  const input = replacement.replace("+new", "+middle") + replacement.replaceAll("target", "./target").replace("-old", "-middle");
  const dry = await run("patch", ["--atomic", "--dry-run"], { files: { target: "old\n" }, input });
  assert.equal(dry.exitCode, 0, dry.stderr);
  assert.equal(await contents(dry.fs, "target"), "old\n");
  const applied = await run("patch", ["--atomic"], { fs: dry.fs, input });
  assert.equal(applied.exitCode, 0, applied.stderr);
  assert.equal(applied.stdout, "patching file target\npatching file target\n");
  assert.equal(await contents(dry.fs, "target"), "new\n");
  const reversed = await run("patch", ["--atomic", "-R"], { fs: dry.fs, input });
  assert.equal(reversed.exitCode, 0, reversed.stderr);
  assert.equal(await contents(dry.fs, "target"), "old\n");
});

const create = "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+old\n";
const remove = "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-new\n";
test("--atomic same-file creation edit deletion collapses and reverses", async () => {
  const input = create + replacement + remove;
  const result = await run("patch", ["--atomic"], { input });
  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(result.fs.stat("/work/target"));
  const reversed = await run("patch", ["--atomic", "-R"], { fs: result.fs, input });
  assert.equal(reversed.exitCode, 0, reversed.stderr);
  await assert.rejects(result.fs.stat("/work/target"));
});

test("--atomic same-file deletion then creation publishes final replacement", async () => {
  const input = remove + create;
  const result = await run("patch", ["--atomic"], { files: { target: "new\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "old\n");
  assert.equal((await run("patch", ["--atomic", "-R"], { fs: result.fs, input })).exitCode, 0);
  assert.equal(await contents(result.fs, "target"), "new\n");
});

test("--atomic --force later conflict prevents distinct and repeated writes", async () => {
  const input = replacement.replaceAll("target", "other") + replacement + replacement;
  const result = await run("patch", ["--atomic", "--force"], { files: { target: "old\n", other: "old\n" }, input });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(await contents(result.fs, "target"), "old\n");
  assert.equal(await contents(result.fs, "other"), "old\n");
});

const mail = "From 0123456789012345678901234567890123456789 Mon Sep 17 00:00:00 2001\n"
  + "From: Example <example@example.invalid>\nSubject: [PATCH] change\n\nDescription.\n---\n target | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n\n"
  + "diff --git a/target b/target\nindex 1234567..abcdef0 100644\n"
  + replacement.replace("--- target", "--- a/target").replace("+++ target", "+++ b/target") + "-- \n2.50.1\n";

for (const option of ["-l", "--ignore-whitespace", "--ignore-white-space"]) test(`loose blanks preserve actual context and literal additions ${option}`, async () => {
  const input = "--- target\n+++ target\n@@ -1,3 +1,3 @@\n head space\n-old value\n+new   value\n tail\tspace\n\\ No newline at end of file\n";
  const result = await run("patch", [option], { files: { target: "head\tspace\nold\t  value\ntail space" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "head\tspace\nnew   value\ntail space");
});

for (const before of ["oldvalue\n", "old\rvalue\n", "old\vvalue\n", "old value", " old value\n"]) test(`loose blanks retain nonblank and EOF distinctions ${JSON.stringify(before)}`, async () => {
  const result = await run("patch", ["-l"], { files: { target: before }, input: replacement.replace("-old", "-old value") });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(await contents(result.fs, "target"), before);
});

test("bounded mail preamble, diffstat and signature apply and reverse", async () => {
  const result = await run("patch", ["-p1"], { files: { target: "old\n" }, input: mail });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
  assert.equal((await run("patch", ["-Rp1"], { fs: result.fs, input: mail })).exitCode, 0);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

for (const input of [
  "Subject: no patch\n\nbody\n", mail.replace("index 1234567..abcdef0 100644", "old mode 100644\nnew mode 100755"),
  mail.replace("index 1234567..abcdef0 100644", "rename from target\nrename to other"),
  mail.replace("+new\n", ""), mail + replacement, "Subject: oversized\n" + "body\n".repeat(1025) + replacement,
]) test("mail never hides malformed, unsupported, or oversized patch data", async () => {
  const result = await run("patch", ["-p1"], { files: { target: "old\n" }, input });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

for (const [name, encoded] of [
  ["file name", "file name"], ['a"quote', 'a\\"quote'], ["café", "caf\\303\\251"],
  ["tab\tname", "tab\\tname"], ["literal\ttab", "literal\ttab"],
]) test(`strict quoted filename roundtrip ${JSON.stringify(name)}`, async () => {
  const input = replacement.replace("--- target", `--- "a/${encoded}"`).replace("+++ target", `+++ "b/${encoded}"`);
  const result = await run("patch", ["-p1"], { files: { [name!]: "old\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, name!), "new\n");
  assert.equal((await run("patch", ["-Rp1"], { fs: result.fs, input })).exitCode, 0);
  assert.equal(await contents(result.fs, name!), "old\n");
});

for (const encoded of ["\\q", "\\400", "\\777", "\\12", "\\300\\257", "\\377", "\\000", "\\n", "\\r", "\\057tmp", "a/\\056\\056/target", "a/C:target", "a/\\\\target"]) {
  test(`decoded unsafe filename rejected before stripping ${encoded}`, async () => {
    const input = replacement + replacement.replaceAll("target", `"${encoded}"`);
    const result = await run("patch", [], { files: { target: "old\n" }, input });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}

test("relative repeated separators collapse before stripping; traversal never does", async () => {
  const result = await run("patch", ["-p1"], { files: { target: "old\n" }, input: replacement.replaceAll("target", "a//target") });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
  const unsafe = await run("patch", ["-p2"], { files: { target: "old\n" }, input: replacement.replaceAll("target", "a//../target") });
  assert.equal(unsafe.exitCode, 2);
  assert.equal(await contents(unsafe.fs, "target"), "old\n");
});

for (const metadata of ["new file mode 120000", "deleted file mode 120000", "similarity index 100%", "dissimilarity index 100%"]) {
  for (const input of [`Subject: example\n${metadata}\n${replacement}`, `${replacement}-- \n${metadata}\n`]) {
    test(`mail cannot hide unsupported metadata ${JSON.stringify(input)}`, async () => {
      const result = await run("patch", [], { files: { target: "old\n" }, input });
      assert.equal(result.exitCode, 2);
      assert.equal(await contents(result.fs, "target"), "old\n");
    });
  }
}

for (const label of ["a/target/", "a/target//", "a/target/.", "a/target/./", "a/target/./."]) {
  for (const args of [["-p1"], ["-p1", "/work/target"]]) {
    test(`directory label remains invalid with explicit target ${label}/${args.join(" ")}`, async () => {
      const result = await run("patch", args, { files: { target: "old\n" }, input: replacement.replaceAll("target", label) });
      assert.equal(result.exitCode, 2);
      assert.equal(await contents(result.fs, "target"), "old\n");
    });
  }
}
