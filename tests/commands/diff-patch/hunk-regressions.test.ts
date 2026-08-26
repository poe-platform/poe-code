import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { toByteSource } from "../../../src/contracts/index.js";
import { Budget } from "../../../src/commands/diff-patch/shared.js";
import { parseUnified, reversePatch } from "../../../src/commands/diff-patch/unified.js";
import { contents, filesystem, run } from "./helpers.js";
import { nativeGNU } from "./patch-gnu-native.js";

const headers = "--- target\n+++ target\n";
const emptyContext = headers + "@@ -1,3 +1,3 @@\n head\n\n-old\n+new\n";

async function nativeDirectory<Result>(operation: (root: string) => Promise<Result>): Promise<Result> {
  const root = await mkdtemp(join(process.cwd(), ".hunk-native-"));
  try { return await operation(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

function native(root: string, tool: "diff" | "patch", args: readonly string[], input = "") {
  const result = spawnSync(`/usr/bin/${tool}`, [...args], {
    cwd: root, input, encoding: "utf8", timeout: 2000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    env: { PATH: "/usr/bin:/bin", HOME: root, TMPDIR: root, LC_ALL: "C", LANG: "C" },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, null);
  return result;
}

for (const reverse of [false, true]) {
  test(`unprefixed empty context applies ${reverse ? "reverse" : "forward"}`, async () => {
    const before = "head\n\nold\n";
    const after = "head\n\nnew\n";
    const result = await run("patch", reverse ? ["-R", "-F0"] : ["-F0"], {
      files: { target: reverse ? after : before }, input: emptyContext,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(result.fs, "target"), reverse ? before : after);
  });
}

test("native patch accepts unprefixed empty context in both directions", async () => {
  await nativeDirectory(async root => {
    for (const reverse of [false, true]) {
      await writeFile(join(root, "target"), reverse ? "head\n\nnew\n" : "head\n\nold\n");
      const result = native(root, "patch", ["-f", "-F0", "-p0", ...(reverse ? ["-R"] : []), "target"], emptyContext);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(await readFile(join(root, "target"), "utf8"), reverse ? "head\n\nold\n" : "head\n\nnew\n");
    }
  });
});

test("unprefixed context preserves empty lines at both hunk edges", async () => {
  const result = await run("patch", [], {
    files: { target: "\nold\n\n" }, input: headers + "@@ -1,3 +1,3 @@\n\n-old\n+new\n\n",
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(result.fs, "target"), "\nnew\n\n");
});

const malformedEmptyContext = [
  ["truncated body", emptyContext.replace("+new\n", "")],
  ["truncated final physical line", emptyContext.slice(0, -1)],
  ["old count overflow", headers + "@@ -1 +1,2 @@\n-old\n\n+new\n"],
  ["new count overflow", headers + "@@ -1,2 +1 @@\n+new\n\n-old\n"],
  ["missing prefix on nonempty context", emptyContext.replace(" head", "head")],
  ["tab is not an empty context line", emptyContext.replace("\n\n", "\n\t\n")],
  ["empty incomplete context", emptyContext.replace("\n\n", "\n\n\\ No newline at end of file\n")],
  ["stray newline marker", emptyContext.replace(" head\n", "\\ No newline at end of file\n head\n")],
  ["unknown newline marker", emptyContext + "\\ unknown marker\n"],
  ["duplicate newline marker", emptyContext + "\\ No newline at end of file\n\\ No newline at end of file\n"],
  ["context after incomplete line", headers + "@@ -1,2 +1,2 @@\n-old\n+new\n\\ No newline at end of file\n\n"],
  ["no changed lines", headers + "@@ -1,2 +1,2 @@\n head\n\n"],
] as const;

for (const [name, input] of malformedEmptyContext) {
  test(`--atomic empty context retains validation: ${name}`, async () => {
    const result = await run("patch", ["--atomic"], { files: { target: "head\n\nold\n" }, input });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(await contents(result.fs, "target"), "head\n\nold\n");
  });
}

test("empty context remains subject to line and work budgets", async () => {
  for (const options of [{ maxLines: 6 }, { maxWork: 4 }]) {
    const result = await run("patch", [], { files: { target: "head\n\nold\n" }, input: emptyContext, options });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /limit exceeded/u);
    assert.equal(await contents(result.fs, "target"), "head\n\nold\n");
  }
});

test("empty context parsing observes cancellation before mutation", async () => {
  const fs = await filesystem({ target: "head\n\nold\n" });
  const controller = new AbortController();
  const reason = new Error("stop parsing empty context");
  const input = headers + "@@ -1,10001 +1,10001 @@\n-old\n+new\n" + "\n".repeat(10_000);
  const pending = run("patch", [], { fs, input, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(reason), 0);
  try { await assert.rejects(pending, error => error === reason); }
  finally { clearTimeout(timer); }
  assert.equal(await contents(fs, "target"), "head\n\nold\n");
});

const dialectHunks = "@@ -1 +1,0 @@\n-a\n@@ -4,0 +4 @@\n+NEW\n@@ -7,0 +8 @@\n+b\n";
const coordinateCases = [
  ["reported BSD three-hunk sequence", "a\nb\na\nb\na\nb\na\n", "b\na\nb\nNEW\na\nb\na\nb\n", dialectHunks],
  ["BSD beginning insertion", "a\nb\n", "new\na\nb\n", "@@ -1,0 +1 @@\n+new\n"],
  ["BSD beginning deletion", "a\nb\n", "b\n", "@@ -1 +1,0 @@\n-a\n"],
  ["BSD multiline beginning insertion", "a\nb\n", "new\nmore\na\nb\n", "@@ -1,0 +1,2 @@\n+new\n+more\n"],
  ["BSD multiline beginning deletion", "a\nb\nc\n", "c\n", "@@ -1,2 +1,0 @@\n-a\n-b\n"],
  ["canonical beginning insertion", "a\nb\n", "new\na\nb\n", "@@ -0,0 +1 @@\n+new\n"],
  ["canonical beginning deletion", "a\nb\n", "b\n", "@@ -1 +0,0 @@\n-a\n"],
  ["canonical first insertion after line one", "a\nb\n", "a\nnew\nb\n", "@@ -1,0 +2 @@\n+new\n"],
  ["canonical first deletion after line one", "a\nb\nc\n", "a\nc\n", "@@ -2 +1,0 @@\n-b\n"],
  ["subsequent empty range at one is not a beginning alias", "a\nb\n", "A\nnew\nb\n", "@@ -1 +1 @@\n-a\n+A\n@@ -1,0 +2 @@\n+new\n"],
  ["normalized leading insertion followed by replacement", "a\nb\nc\n", "new\na\nB\nc\n", "@@ -1,0 +1 @@\n+new\n@@ -2 +3 @@\n-b\n+B\n"],
  ["normalized leading deletion followed by replacement", "a\nb\nc\n", "b\nC\n", "@@ -1 +1,0 @@\n-a\n@@ -3 +2 @@\n-c\n+C\n"],
  ["canonical empty file insertion", "", "new\n", "@@ -0,0 +1 @@\n+new\n"],
  ["canonical entire file deletion", "old\n", "", "@@ -1 +0,0 @@\n-old\n"],
  ["normalized deletion with incomplete final replacement", "a\nb\nc", "b\nC", "@@ -1 +1,0 @@\n-a\n@@ -3 +2 @@\n-c\n\\ No newline at end of file\n+C\n\\ No newline at end of file\n"],
] as const;

for (const [name, before, after, hunks] of coordinateCases) {
  for (const reverse of [false, true]) {
    test(`GNU interpretation of historical coordinates ${reverse ? "reverse" : "forward"}: ${name}`, async () => {
      const args = ["--batch", "-p0", "-F0", ...(reverse ? ["-R"] : [])];
      const expected = await nativeGNU(args,
        { target: reverse ? after : before }, headers + hunks);
      const result = await run("patch", args, {
        files: { target: reverse ? after : before }, input: headers + hunks,
      });
      assert.equal(result.exitCode, expected.exitCode, result.stderr);
      assert.equal(await contents(result.fs, "target"), expected.files.target);
    });
  }
}

test("GNU empty coordinates remain literal before reversal", async () => {
  const budget = new Budget({
    command: "patch", args: [], cwd: "/work", env: {}, fs: await filesystem(), stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} }, signal: new AbortController().signal,
  }, {});
  const parsed = await parseUnified(headers + dialectHunks, budget);
  assert.equal(parsed.length, 1);
  const patch = parsed[0]!;
  assert.deepEqual(patch.hunks.map(hunk => [hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount]), [
    [1, 1, 1, 0], [4, 0, 4, 1], [7, 0, 8, 1],
  ]);
  assert.deepEqual(reversePatch(patch).hunks.map(hunk => [hunk.oldStart, hunk.oldCount, hunk.newStart, hunk.newCount]), [
    [1, 0, 1, 1], [4, 1, 4, 0], [8, 1, 7, 0],
  ]);
  assert.deepEqual(reversePatch(reversePatch(patch)), patch);
});

test("GNU empty coordinates remain literal for each file section", async () => {
  const input = headers + "@@ -1,0 +1 @@\n+new\n" + "--- other\n+++ other\n@@ -1 +1,0 @@\n-old\n";
  const fs = await filesystem({ target: "a\n", other: "old\nb\n" });
  for (const reverse of [false, true]) {
    const result = await run("patch", reverse ? ["-R"] : [], { fs, input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await contents(fs, "target"), reverse ? "a\n" : "a\nnew\n");
    assert.equal(await contents(fs, "other"), reverse ? "b\nold\n" : "b\n");
  }
});

const invalidCoordinates = [
  ["nonempty zero remains invalid", "@@ -0 +1 @@\n-a\n+A\n"],
  ["both ranges empty", "@@ -1,0 +1,0 @@\n"],
  ["unsafe coordinate integer", "@@ -9007199254740992,0 +1 @@\n+new\n"],
  ["coordinate limit", "@@ -100001,0 +100002 @@\n+new\n"],
  ["normalized header still checks body overflow", "@@ -1 +1,0 @@\n-a\n+new\n"],
  ["normalized header still checks body truncation", "@@ -1,0 +1,2 @@\n+new\n"],
  ["normalized header cannot hide incomplete middle line", "@@ -1,0 +1,2 @@\n+new\n\\ No newline at end of file\n+more\n"],
] as const;

for (const [name, hunks] of invalidCoordinates) {
  test(`--atomic empty-range normalization retains rejection: ${name}`, async () => {
    for (const reverse of [false, true]) {
      const result = await run("patch", reverse ? ["--atomic", "-R"] : ["--atomic"], { files: { target: "a\nb\nc\n" }, input: headers + hunks });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(await contents(result.fs, "target"), "a\nb\nc\n");
    }
  });
}

test("normalized hunks retain hunk and coordinate budgets", async () => {
  for (const options of [{ maxHunks: 1 }, { maxLines: 7 }]) {
    const result = await run("patch", [], {
      files: { target: "a\nb\na\nb\na\nb\na\n" }, input: headers + dialectHunks, options,
    });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /limit exceeded/u);
    assert.equal(await contents(result.fs, "target"), "a\nb\na\nb\na\nb\na\n");
  }
});

test("bounded native-generated zero-context patches have independent forward and reverse controls", async context => {
  await nativeDirectory(async root => {
    context.diagnostic(native(root, "diff", ["--version"]).stdout.trim());
    context.diagnostic(native(root, "patch", ["--version"]).stdout.trim());
    let oracleMismatches = 0;
    let canonicalMismatches = 0;
    let fullContextMismatches = 0;
    for (const [name, before, after] of coordinateCases) {
      await writeFile(join(root, "old"), before);
      await writeFile(join(root, "next"), after);
      const generated = native(root, "diff", ["-U0", "--label", "target", "--label", "target", "old", "next"]);
      assert.equal(generated.status, 1, generated.stderr);
      const fullContext = native(root, "diff", ["-U100", "--label", "target", "--label", "target", "old", "next"]);
      assert.equal(fullContext.status, 1, fullContext.stderr);
      for (const reverse of [false, true]) {
        const original = reverse ? after : before;
        const expected = reverse ? before : after;
        const args = ["--batch", "-p0", "-F0", ...(reverse ? ["-R"] : [])];
        const actual = await run("patch", args, {
          files: { target: original }, input: generated.stdout,
        });
        const gnu = await nativeGNU(args,
          { target: original }, generated.stdout);
        assert.equal(actual.exitCode, gnu.exitCode, `${name}: ${actual.stderr}`);
        assert.equal(await contents(actual.fs, "target"), gnu.files.target, name);
        await writeFile(join(root, "target"), original);
        const reference = native(root, "patch", ["-f", "-F0", "-p0", ...(reverse ? ["-R"] : []), "target"], generated.stdout);
        const referenceText = await readFile(join(root, "target"), "utf8");
        if (reference.status !== 0 || referenceText !== expected) {
          oracleMismatches++;
          context.diagnostic(`native-native mismatch ${JSON.stringify({ name, reverse, status: reference.status, expected, actual: referenceText })}`);
        }
        const canonical = generated.stdout.replace(/^(@@ -)1,0 (\+1(?:,\d+)? @@)/mu, "$10,0 $2")
          .replace(/^(@@ -1(?:,\d+)? \+)1,0 @@/mu, "$10,0 @@");
        await writeFile(join(root, "target"), original);
        const control = native(root, "patch", ["-f", "-F0", "-p0", ...(reverse ? ["-R"] : []), "target"], canonical);
        const controlText = await readFile(join(root, "target"), "utf8");
        if (control.status !== 0 || controlText !== expected) {
          canonicalMismatches++;
          context.diagnostic(`canonical-native mismatch ${JSON.stringify({ name, reverse, status: control.status, expected, actual: controlText })}`);
        }
        await writeFile(join(root, "target"), original);
        const fullControl = native(root, "patch", ["-f", "-F0", "-p0", ...(reverse ? ["-R"] : []), "target"], fullContext.stdout);
        const fullText = await readFile(join(root, "target"), "utf8");
        if (fullControl.status !== 0 || fullText !== expected) {
          fullContextMismatches++;
          context.diagnostic(`full-context native-native mismatch ${JSON.stringify({ name, reverse, status: fullControl.status, expected, actual: fullText })}`);
        }
      }
    }
    context.diagnostic(`native-generated directions=${coordinateCases.length * 2}; native-native mismatches=${oracleMismatches}; canonical-native mismatches=${canonicalMismatches}; full-context native-native mismatches=${fullContextMismatches}`);
  });
});
