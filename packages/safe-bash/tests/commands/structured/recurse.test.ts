import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { Shell, createMemoryFileSystem, agentCommands } from "../../../src/index.js";
import { run } from "./helpers.js";
import { Interpreter } from "../../../src/commands/structured/interpreter.js";
import { registerYieldCheckpoint } from "../../../src/contracts/yield.js";

const cases: [string, unknown][] = [
  ['[recurse(.a? // empty) | type]', { a: { a: 1 } }],
  ['[recurse(.[]?)]', { a: [1, null], b: false }],
  ['[recurse(empty)]', null],
  ['[recurse(if . < 3 then (.+1, .+2) else empty end)]', 0],
  ['[recurse(.+1; .<4)]', 0],
  ['[recurse(.+1; (false, .<2))]', 0],
  ['[recurse]', [1, { a: false }]],
  ['[limit(3; recurse(.a))]', { a: null }],
  ['first(recurse(error("unused")))', 0],
  ['[limit(5; recurse(.+1))]', 0],
  ['recurse(.[])', 1],
  ['recurse(error("child"))', null],
  ['try recurse(error("child")) catch .', null],
  ['def visit(f): recurse(f); [visit(.a? // empty)]', { a: 2 }],
  ['recurse(.; .; .)', null],
];

for (const [filter, value] of cases) test(`public jq recurse matches native: ${filter}`, async () => {
  const stdin = `${JSON.stringify(value)}\n`;
  const native = spawnSync("/usr/bin/jq", ["-c", filter], { input: stdin, encoding: "utf8", timeout: 2000, env: { ...process.env, LC_ALL: "C" } });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  assert.notEqual(native.status, null);
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(`jq -c '${filter}'`, { stdin });
    assert.deepEqual({ exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }, { exitCode: native.status, stdout: native.stdout, stderr: native.stderr });
  } finally { await shell.dispose(); }
});

test("infinite recurse respects noncatchable work limits", async () => {
  const result = await run(["-c", 'try recurse(.+1) catch "caught"'], "0", { limits: { maxSteps: 100 } });
  assert.equal(result.exitCode, 5);
  assert.ok(result.stderr.includes("maxSteps limit exceeded"));
  assert.ok(!result.stdout.includes("caught"));
});

test("long recurse traversals avoid recursive JavaScript calls", async () => {
  const result = await run(["-c", "last(limit(1000; recurse(.+1)))"], "0");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "999\n");
  assert.equal(result.stderr, "");
});

test("recurse retires suspended filters on early consumption and errors", async context => {
  let active = 0;
  const original = Interpreter.prototype.run;
  context.mock.method(Interpreter.prototype, "run", async function* (this: Interpreter, ...args: Parameters<Interpreter["run"]>) {
    active++;
    try { yield* original.apply(this, args); }
    finally { active--; }
  });
  for (const filter of ['first(recurse(.+1))', 'limit(4; recurse(.+1; (true,true)))', 'recurse(error("child"))']) {
    await run(["-c", filter], "0");
    assert.equal(active, 0);
  }
});

test("recurse cooperatively handles cancellation", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel recurse");
  registerYieldCheckpoint(controller.signal, () => controller.abort(reason));
  await assert.rejects(run(["-c", "recurse(.+1)"], "0", {}, { signal: controller.signal }), error => error === reason);
});

test("recurse bounds retained child streams", async () => {
  const result = await run(["-c", 'try recurse(.+1) catch "caught"'], "0", { limits: { maxCollectionSize: 4 } });
  assert.equal(result.exitCode, 5);
  assert.ok(result.stderr.includes("maxCollectionSize limit exceeded"));
  assert.ok(!result.stdout.includes("caught"));
});
