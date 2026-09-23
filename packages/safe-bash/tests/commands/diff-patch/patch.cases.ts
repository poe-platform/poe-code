import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { diffPatchCommands } from "../../../src/commands/diff-patch/index.js";
import { contents, filesystem, replacement, run } from "./helpers.js";

for (const args of [["-b"], ["--backup"], ["--binary"], ["-g0"], ["--get=0"], ["-N"], ["--forward"]]) {
  test(`patch admits ${args.join(" ")} and applies an exact patch`, async () => {
    const result = await run("patch", args, { files: { target: "old\n" }, input: replacement });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), "new\n");
    if (args[0] === "-b" || args[0] === "--backup") assert.equal(await contents(result.fs, "target.orig"), "old\n");
  });
}

test("Shell combines directory, input, output, backup, forward, binary and get options", async () => {
  const fs = await filesystem({ "dir/target": "old\n", "dir/change": replacement });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(diffPatchCommands());
  const result = await shell.exec("patch --batch -p0 -d dir -i change -o result -b -N --binary -g0");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(fs, "dir/target"), "old\n");
  assert.equal(await contents(fs, "dir/result"), "new\n");
  assert.equal(await contents(fs, "dir/target.orig"), "old\n");
  const cwd = await shell.exec("pwd");
  assert.equal(cwd.stdout, "/work\n");
});

test("patch forward skips an already applied patch without reversing the target", async () => {
  const result = await run("patch", ["-N"], { files: { target: "new\n" }, input: replacement });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
  assert.match(result.stdout, /Skipping patch/u);
});

for (const args of [["-o", "target"], ["-o", "change", "-i", "change"], ["-d", "missing"], ["-g1"]]) {
  test(`patch refuses unsafe or unavailable options ${args.join(" ")} before modifying targets`, async () => {
    const result = await run("patch", args, { files: { target: "old\n", change: replacement }, input: replacement });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
    assert.equal(await contents(result.fs, "change"), replacement);
  });
}

for (const atomic of [[], ["--atomic"]]) {
  test(`patch alternate output concatenates file sections ${atomic.join(" ")}`, async () => {
    const result = await run("patch", [...atomic, "-oresult"], { files: { target: "old\n", other: "old\n", result: "stale\n" }, input: replacement + replacement.replaceAll("target", "other") });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "result"), "new\nnew\n");
    assert.equal(await contents(result.fs, "target"), "old\n");
    assert.equal(await contents(result.fs, "other"), "old\n");
  });
}

test("patch dry-run with backup and output does not create files", async () => {
  const result = await run("patch", ["--dry-run", "-b", "-oresult"], { files: { target: "old\n" }, input: replacement });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual((await result.fs.readdir("/work")).map(entry => entry.name), ["target"]);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

test("patch backup suffix rejects traversal before publication", async () => {
  const result = await run("patch", ["-b", "-z/../../escaped"], { files: { target: "old\n" }, input: replacement });
  assert.equal(result.exitCode, 2);
  assert.equal(await contents(result.fs, "target"), "old\n");
});

test("patch unconditional backup creates an empty placeholder for a new file", async () => {
  const input = "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+new\n";
  const result = await run("patch", ["-b"], { input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "new\n");
  assert.equal(await contents(result.fs, "target.orig"), "");
});

for (const [args, name] of [
  [["-b", "-z.bak"], "target.bak"],
  [["--backup", "--suffix=.save"], "target.save"],
  [["-b", "-Bbackups/"], "backups/target.orig"],
  [["-b", "-Ysaved-"], "saved-target.orig"],
  [["-b", "-Vnumbered"], "target.~1~"],
  [["-b", "--version-control=simple"], "target.orig"],
] as const) {
  test(`patch backup naming ${args.join(" ")}`, async () => {
    const result = await run("patch", args, { files: { target: "old\n" }, input: replacement });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, name), "old\n");
  });
}

for (const args of [["-o", "result"], ["--output=result"], ["--atomic", "-oresult"]]) {
  test(`patch ${args.join(" ")} writes alternate output and preserves input`, async () => {
    const result = await run("patch", args, { files: { target: "old\n" }, input: replacement });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), "old\n");
    assert.equal(await contents(result.fs, "result"), "new\n");
    assert.equal(result.stdout, "patching file result (read from target)\n");
  });
}

for (const args of [["-d", "dir"], ["--directory=dir"]]) {
  test(`patch ${args.join(" ")} resolves targets and patch input in the selected directory`, async () => {
    const result = await run("patch", [...args, "-i", "change"], { files: { target: "old\n", "dir/target": "old\n", "dir/change": replacement } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), "old\n");
    assert.equal(await contents(result.fs, "dir/target"), "new\n");
  });
}

test("patch reads -i, dry-run does not modify, and reverse restores bytes", async () => {
  const fs = await filesystem({ target: "old\n", "changes.diff": replacement });
  const dry = await run("patch", ["--dry-run", "-i", "changes.diff"], { fs });
  assert.equal(dry.exitCode, 0, dry.stderr);
  assert.equal(await contents(fs, "target"), "old\n");
  assert.match(dry.stdout, /^checking file/u);
  const applied = await run("patch", ["--input=changes.diff", "--strip=0", "-u"], { fs });
  assert.equal(applied.exitCode, 0, applied.stderr);
  assert.equal(await contents(fs, "target"), "new\n");
  const reverse = await run("patch", ["-Ri", "changes.diff"], { fs });
  assert.equal(reverse.exitCode, 0, reverse.stderr);
  assert.equal(await contents(fs, "target"), "old\n");
});

test("space-containing filenames and tab-delimited timestamps", async () => {
  const input = replacement.replaceAll("target\n", "space name\t2026-08-26 00:00:00 +0000\n");
  const result = await run("patch", [], { files: { "space name": "old\n" }, input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "space name"), "new\n");
});

test("zero-fuzz patch conflicts preserve actual context", async () => {
  const input = "--- target\n+++ target\n@@ -1,3 +1,3 @@\n expected head\n-old\n+new\n expected tail\n";
  const files = { target: "prefix\nactual head\nold\nactual tail\nsuffix\n" };
  const strict = await run("patch", ["-F0"], { files, input });
  assert.equal(strict.exitCode, 1, strict.stderr);
  assert.equal(await contents(strict.fs, "target"), files.target);
});

test("offset-only matching succeeds at fuzz zero and carries offsets across hunks", async () => {
  const input = "--- target\n+++ target\n@@ -1 +1 @@\n-one\n+ONE\n@@ -4 +4 @@\n-four\n+FOUR\n";
  const files = { target: "prefix\none\ntwo\nthree\nfour\n" };
  const actual = await run("patch", ["-F0"], { files, input });
  assert.equal(actual.exitCode, 0, actual.stderr);
});

test("fuzz never ignores deletion content", async () => {
  const input = "--- target\n+++ target\n@@ -1,3 +1,3 @@\n head\n-old\n+new\n tail\n";
  const result = await run("patch", ["-F1000"], { files: { target: "head\nwrong\ntail\n" }, input });
  assert.equal(result.exitCode, 1);
  assert.equal(await contents(result.fs, "target"), "head\nwrong\ntail\n");
});

test("--atomic preflights all hunks before modifying one file", async () => {
  const input = replacement + "@@ -3 +3 @@\n-missing\n+changed\n";
  const result = await run("patch", ["--atomic"], { files: { target: "old\nsecond\nthird\n" }, input });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(await contents(result.fs, "target"), "old\nsecond\nthird\n");
});

test("--atomic preflights all files before modifying any file", async () => {
  const input = replacement + replacement.replaceAll("target", "other");
  const result = await run("patch", ["--atomic"], { files: { target: "old\n", other: "wrong\n" }, input });
  assert.equal(result.exitCode, 1);
  assert.equal(await contents(result.fs, "target"), "old\n");
  assert.equal(await contents(result.fs, "other"), "wrong\n");
  assert.deepEqual((await result.fs.readdir("/work")).map(entry => entry.name).sort(), ["other", "target"]);
});

test("multifile creation/deletion reverses without reject files", async () => {
  const input = "--- /dev/null\n+++ fresh\n@@ -0,0 +1,2 @@\n+first\n+last\n\\ No newline at end of file\n"
    + "--- gone\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n";
  const fs = await filesystem({ gone: "gone\n" });
  const actual = await run("patch", [], { fs, input });
  assert.equal(actual.exitCode, 0, actual.stderr);
  await assert.rejects(fs.stat("/work/gone"));
  const reverse = await run("patch", ["--reverse"], { fs, input });
  assert.equal(reverse.exitCode, 0, reverse.stderr);
  assert.equal(await contents(fs, "gone"), "gone\n");
  await assert.rejects(fs.stat("/work/fresh"));
});

test("--atomic create/delete failures preserve preexisting content", async () => {
  const creation = "--- /dev/null\n+++ target\n@@ -0,0 +1 @@\n+created\n";
  const existing = await run("patch", ["--atomic"], { files: { target: "existing\n" }, input: creation });
  assert.equal(existing.exitCode, 1);
  assert.equal(await contents(existing.fs, "target"), "existing\n");
  const deletion = "--- target\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n";
  const remaining = await run("patch", ["--atomic"], { files: { target: "old\nretained\n" }, input: deletion });
  assert.equal(remaining.exitCode, 1);
  assert.equal(await contents(remaining.fs, "target"), "old\nretained\n");
});

test("creation makes missing parent directories with -p0", async () => {
  const input = "--- /dev/null\n+++ absent/target\n@@ -0,0 +1 @@\n+created\n";
  const result = await run("patch", ["-p0"], { input });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "absent/target"), "created\n");
});

test("empty patch is a successful no-op", async () => {
  assert.equal((await run("patch", [], { input: "" })).exitCode, 0);
});

const malformed = [
  ["missing new header", "--- target\n"],
  ["missing hunks", "--- target\n+++ target\n"],
  ["truncated body", replacement.replace("+new\n", "")],
  ["extra body line", replacement + "+extra\n"],
  ["bad body prefix", replacement.replace("-old", "!old")],
  ["zero nonempty start", replacement.replace("-1 +1", "-0 +1")],
  ["unsafe integer", replacement.replace("-1 +1", "-9007199254740992 +1")],
  ["empty range", replacement.replace("-1 +1", "-0,0 +0,0")],
  ["no changes", "--- target\n+++ target\n@@ -1 +1 @@\n old\n"],
  ["unknown marker", replacement + "\\ unknown marker\n"],
  ["empty incomplete line", replacement.replace("+new\n", "+\n\\ No newline at end of file\n")],
  ["duplicate marker", replacement.replace("-old\n", "-old\n\\ No newline at end of file\n\\ No newline at end of file\n")],
  ["content after missing newline", "--- target\n+++ target\n@@ -1,2 +1 @@\n-old\n\\ No newline at end of file\n-more\n+new\n"],
  ["truncated physical line", replacement.slice(0, -1)],
  ["unsupported preamble", "Unrecognized preamble\n" + replacement],
  ["git symlink metadata", "diff --git a/target b/target\nindex 1111111..2222222 120000\n" + replacement],
  ["git rename metadata", "rename from target\nrename to other\n" + replacement],
  ["metadata without patch", "diff --git a/target b/target\n"],
  ["unterminated quoted filename", replacement.replace("--- target", '--- "target')],
  ["both null", replacement.replaceAll("target", "/dev/null")],
];

test("--atomic --force repeated target conflict has no early writes", async () => {
  const result = await run("patch", ["--atomic", "--force"], { files: { target: "old\n" }, input: replacement + replacement });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(await contents(result.fs, "target"), "old\n");
});

for (const [name, input] of malformed) test(`--atomic malformed patch rejected before modification: ${name}`, async () => {
  const result = await run("patch", ["--atomic"], { files: { target: "old\n" }, input: input! });
  assert.equal(result.exitCode, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(await contents(result.fs, "target"), "old\n");
});

for (const args of [["-p-1"], ["--fuzz=NaN"], ["-i"], ["--output="], ["a", "b"], ["/dev/null"], ["--strip=9007199254740992"]]) {
  test(`patch rejects unsupported or invalid options ${JSON.stringify(args)}`, async () => {
    const result = await run("patch", args, { files: { target: "old\n" }, input: replacement });
    assert.equal(result.exitCode, 2);
    assert.equal(await contents(result.fs, "target"), "old\n");
  });
}
