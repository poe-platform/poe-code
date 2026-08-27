import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { exprCommands } from "../../../src/commands/expr/index.js";
import { RegexSession } from "../../../src/commands/regex-execution/client.js";
import { diagnosticCases, validControls } from "./diagnostics/cases.js";
import { deferred, run } from "./helpers.js";

for (const specimen of diagnosticCases) test(`C diagnostic ${specimen.cohort}: ${specimen.id}`, async () => {
  const result = await run(specimen.args);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdoutHex, "");
  assert.equal(result.stderr, specimen.stderr);
});

for (const [id, args, stdout, exitCode] of validControls) test(`diagnostic grammar control: ${id}`, async () => {
  const result = await run(args);
  assert.equal(result.exitCode, exitCode);
  assert.equal(result.stdout, stdout);
  assert.equal(result.stderr, "");
});

test("empty invocation guidance uses the registered virtual name and help remains virtual", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(exprCommands());
  try {
    const result = await shell.exec("expr");
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr, "expr: missing operand\nTry 'expr --help' for more information.\n");
    const help = await shell.exec("expr --help");
    assert.equal(help.exitCode, 0);
    assert.equal(help.stderr, "");
    assert.match(help.stdout, /^Usage: expr EXPRESSION\n/u);
    assert.equal((await shell.exec("expr --version")).stdout, "expr (virtual-bash)\n");
  } finally { await shell.dispose(); }
});

test("skipped grammar errors submit no BRE requests or acquire stdin", async () => {
  const original = RegexSession.prototype.matchExpr;
  let requests = 0;
  RegexSession.prototype.matchExpr = function () { requests++; throw new Error("unexpected BRE request"); };
  try {
    for (const specimen of diagnosticCases.filter(specimen => specimen.id.startsWith("skip"))) {
      assert.equal((await run(specimen.args)).stderr, specimen.stderr);
    }
    for (const [id, args, stdout] of validControls.filter(([id]) => id.startsWith("skip"))) {
      assert.equal((await run(args)).stdout, stdout, id);
    }
    assert.equal(requests, 0);
  } finally { RegexSession.prototype.matchExpr = original; }
});

test("diagnostic expansion stays within string, work, and output budgets", async () => {
  for (const [limits, label] of [
    [{ maxStringBytes: 8 }, "string allocation"],
    [{ maxSteps: 15 }, "evaluation work"],
    [{ maxOutputBytes: 40 }, "output bytes"],
  ] as const) {
    const result = await run(["1", "éé"], { limits });
    assert.equal(result.exitCode, 3);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, `expr: ${label} limit exceeded\n`);
  }
  const ordinary = await run(["1", "x"]);
  const exact = Buffer.byteLength(ordinary.stderr);
  assert.equal((await run(["1", "x"], { limits: { maxOutputBytes: exact } })).stderr, ordinary.stderr);
  assert.equal((await run(["1", "x"], { limits: { maxOutputBytes: exact - 1 } })).exitCode, 3);
});

test("argument, numeric, node and depth refusals retain precedence and status", async () => {
  for (const [args, limits, message] of [
    [["1", "extra"], { maxArgumentBytes: 3 }, "aggregate argument bytes"],
    [["12", "+", "1"], { maxNumericDigits: 1 }, "numeric digits"],
    [["1", "+", "2"], { maxNodes: 2 }, "AST node"],
    [["(", "(", "1"], { maxDepth: 1 }, "parser depth"],
  ] as const) {
    const result = await run(args, { limits });
    assert.equal(result.exitCode, 3);
    assert.equal(result.stderr, `expr: ${message} limit exceeded\n`);
  }
});

test("diagnostic writes preserve backpressure and exact sink exception identity", async () => {
  const entered = deferred(), release = deferred();
  let settled = false;
  const pending = run(["1", "extra"], {}, { stderr: { async write() { entered.resolve(); await release.promise; } } });
  void pending.then(() => { settled = true; });
  await entered.promise;
  assert.equal(settled, false);
  release.resolve();
  assert.equal((await pending).exitCode, 2);
  for (const reason of [undefined, null, false, 0, "", new FsError("EPIPE")]) {
    await assert.rejects(run([], {}, { stderr: { async write() { throw reason; } } }), error => error === reason);
  }
});

test("aborted diagnostics preserve the caller reason, including pending sink rejection", async () => {
  const controller = new AbortController(), entered = deferred(), release = deferred();
  const reason = new FsError("ENOENT", { message: "caller diagnostic abort" });
  const pending = run([], {}, { signal: controller.signal, stderr: { async write() {
    entered.resolve(); await release.promise; throw new Error("late diagnostic sink rejection");
  } } });
  const rejected = assert.rejects(pending, error => error === reason);
  await entered.promise;
  controller.abort(reason);
  await rejected;
  release.resolve();
  await new Promise<void>(resolve => setImmediate(resolve));
  await assert.rejects(run([], {}, { signal: controller.signal }), error => error === reason);
});
