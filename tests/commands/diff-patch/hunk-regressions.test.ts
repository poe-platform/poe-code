import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { contents, filesystem, run } from "./helpers.js";

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
  test(`empty context retains validation: ${name}`, async () => {
    const result = await run("patch", [], { files: { target: "head\n\nold\n" }, input });
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
