import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { exprCommands, createExprCommand, type ExprLimits } from "../../../src/commands/expr/index.js";
import { run, deferred } from "./helpers.js";

for (const [limits, subject, pattern, diagnostic] of [
  [{ maxRegexPatternBytes: 1 }, "abc", "a*", "input bytes"],
  [{ maxRegexNodes: 3 }, "abc", "a*", "nodes"],
  [{ maxRegexDepth: 1 }, "a", "\\(\\(a\\)\\)", "depth"],
  [{ maxRegexStates: 2 }, "aaaa", "a*", "states"],
  [{ maxRegexAllocatedUnits: 32 }, "aaaa", "a*", "allocation"],
  [{ maxSteps: 500 }, "a".repeat(16), "\\(a\\|aa\\)*b", "work"],
  [{ maxOutputBytes: 2 }, "abc", "\\(.*\\)", "output bytes"],
] as const) test(`expr regex cap: ${diagnostic}`, async () => {
  const actual = await run(["+", subject, ":", pattern], { limits });
  assert.equal(actual.exitCode, 3, actual.stderr);
  assert.equal(actual.stdout, "");
  assert.ok(actual.stderr.includes(diagnostic), actual.stderr);
});

test("regex policy ceilings are validated at factory creation", () => {
  for (const key of ["maxRegexPatternBytes", "maxRegexNodes", "maxRegexDepth", "maxRegexStates", "maxRegexAllocatedUnits"] as const) {
    for (const value of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => createExprCommand({ limits: { [key]: value } as Partial<ExprLimits> }), RangeError);
    }
  }
});

test("regex capture output preserves partial C bytes and waits for backpressure", async () => {
  const entered = deferred(), released = deferred();
  let output: Uint8Array | undefined, settled = false;
  const pending = run(["é", ":", "\\(.\\)"], {}, { stdout: { async write(chunk) {
    output = Uint8Array.from(chunk); entered.resolve(); await released.promise;
  } } }).then(result => { settled = true; return result; });
  await entered.promise;
  assert.equal(settled, false);
  assert.equal(Buffer.from(output!).toString("hex"), "c30a");
  released.resolve();
  assert.equal((await pending).exitCode, 0);
});

test("actual Shell expr plugin evaluates regex in pipelines and redirections", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands());
  shell.use(exprCommands());
  try {
    const capture = await shell.exec("expr '/tmp/report.txt' : '.*/\\(.*\\)' > /name; cat /name");
    assert.equal(capture.exitCode, 0); assert.equal(capture.stdout, "report.txt\n");
    const pipe = await shell.exec("expr abc : 'a\\(.\\)' | cat");
    assert.equal(pipe.stdout, "b\n");
    const unicode = await shell.exec("LC_ALL=C.UTF-8 expr '😀é' : '..'");
    assert.equal(unicode.stdout, "2\n");
    const skipped = await shell.exec("expr 1 '|' match '' '['");
    assert.equal(skipped.stdout, "1\n");
    const invalid = await shell.exec("expr '' : '['");
    assert.equal(invalid.exitCode, 2);
  } finally { await shell.dispose(); }
});
