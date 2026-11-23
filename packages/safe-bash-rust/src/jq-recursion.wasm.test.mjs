import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { RustWasmBash } from "./index.js";

test("jq recursion stays bounded with optimized Wasm frames", () => {
  const child = spawnSync(process.execPath, [
    "--no-liftoff", "--test", "--test-reporter=tap",
    "--test-name-pattern=^(exhausted jq function and path recursion|jq handles two hundred nested user calls)",
    import.meta.filename,
  ], {encoding: "utf8", env: {...process.env, NODE_TEST_CONTEXT: undefined}});
  assert.equal(child.status, 0, child.error?.message ?? child.stdout + child.stderr);
  assert.match(child.stdout, /# pass 2\n/);
});

test("exhausted jq function and path recursion reports a limit and leaves the shell usable", () => {
  const bash = new RustWasmBash();
  try {
    for (const program of [
      "def f: f; f",
      "def f: . |= f; try f catch 0",
      "def f: f; path(f)",
      "def f: if . > 0 then .-1 | f else . end; 10000 | f",
    ]) {
      const r = bash.execSync("jq -n '" + program + "'");
      assert.deepEqual([r.exitCode, r.stdout, r.stderr], [5, "", "jq: maxDepth limit exceeded\n"]);
      assert.equal(bash.execSync("echo ok").stdout, "ok\n");
    }
  } finally { bash.dispose(); }
});

test("jq handles two hundred nested user calls without losing the shell", () => {
  const bash = new RustWasmBash();
  try {
    const result = bash.execSync("jq -n 'def countdown: if . > 0 then .-1 | countdown else . end; 200 | countdown'");
    assert.deepEqual([result.exitCode, result.stdout, result.stderr], [0, "0\n", ""]);
    assert.equal(bash.execSync("echo still-running").stdout, "still-running\n");
  } finally { bash.dispose(); }
});
