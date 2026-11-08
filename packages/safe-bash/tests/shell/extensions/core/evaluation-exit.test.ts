import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function bounded<Value>(promise: Promise<Value>, label: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within the observation bound`)), 750);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

function setup(options: { readonly held?: boolean; readonly cleanupFailure?: Error } = {}) {
  const events: string[] = [];
  const active = new Set<string>();
  const retired: string[] = [];
  const early: string[] = [];
  const returned: string[] = [];
  const cleanupStarted = deferred();
  const cleanupGate = deferred();
  if (!options.held) cleanupGate.resolve();
  let sequence = 0;
  const execute = async (context: ShellExtensionContext): Promise<number> => {
    const owner = `${context.command}:${++sequence}`;
    active.add(owner);
    events.push(`enter:${owner}`);
    context.registerCleanup(async () => {
      events.push(`cleanup:${owner}`);
      if (active.has(owner)) early.push(owner);
      cleanupStarted.resolve();
      await cleanupGate.promise;
      retired.push(owner);
      events.push(`drained:${owner}`);
      if (options.cleanupFailure) throw options.cleanupFailure;
    });
    try {
      const status = await context.evaluate(context.argumentValues[0] ?? "");
      returned.push(owner);
      return status;
    } finally {
      active.delete(owner);
      events.push(`unwind:${owner}`);
    }
  };
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 1500 }, extensions: [
    trapExtension(),
    { name: "evaluation-exit-review", create: () => ({ builtins: ["probe", "nested"].map(name => ({ name, execute })) }) },
  ] });
  for (const command of basicCommands()) shell.register(command);
  return { shell, events, active, early, retired, returned, cleanupStarted, cleanupGate,
    async close() { cleanupGate.resolve(); await bounded(shell.dispose(), "shell disposal"); },
  };
}

const cases = [
  { name: "literal exit", source: "probe 'exit 7'; printf after", status: 7, stdout: "", owners: 1 },
  { name: "callback function exit", source: "callback() { exit 7; }; probe callback; printf after", status: 7, stdout: "", owners: 1 },
  { name: "nested callback functions", source: "callback() { exit 7; }; middle() { callback; }; probe middle; printf after", status: 7, stdout: "", owners: 1 },
  { name: "nested extension evaluations", source: "callback() { exit 7; }; probe 'nested callback'; printf after", status: 7, stdout: "", owners: 2 },
  { name: "EXIT trap retains original status", source: `trap 'printf "EXIT:%s;" "$?"' EXIT; callback() { exit 7; }; probe callback; printf after`, status: 7, stdout: "EXIT:7;", owners: 1 },
  { name: "EXIT handler nested evaluator replaces status", source: `trap 'nested "printf TRAP; exit 9"' EXIT; callback() { exit 7; }; probe callback; printf after`, status: 9, stdout: "TRAP", owners: 2 },
  { name: "EXIT handler sees callback locals", source: `trap 'printf "%s" "$value"' EXIT; value=outer; callback() { local value=inner; exit 7; }; probe callback; printf after`, status: 7, stdout: "inner", owners: 1 },
  { name: "exit does not synthesize RETURN", source: `trap 'printf "RETURN;"' RETURN; callback() { exit 7; }; probe callback; printf after`, status: 7, stdout: "", owners: 1 },
] as const;

for (const entry of cases) test(`evaluation exit: ${entry.name} unwinds each owner before cleanup`, { timeout: 2500 }, async () => {
  const subject = setup();
  try {
    const result = await bounded(subject.shell.exec(entry.source), entry.name);
    assert.equal(result.exitCode, entry.status, result.stderr);
    assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(entry.stdout));
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.alloc(0));
    assert.deepEqual(subject.returned, [], "current-shell exit must escape evaluate, not become a normal callback return");
    assert.equal(subject.active.size, 0);
    assert.equal(subject.retired.length, entry.owners);
    assert.equal(new Set(subject.retired).size, entry.owners, "each owned drain runs once");
    assert.deepEqual(subject.early, [], subject.events.join(" -> "));
  } finally { await subject.close(); }
});

for (const entry of cases) test(`pinned Bash evaluation exit: ${entry.name}`, nativeOptions(), () => {
  const expected = runNative(`probe() { eval "$1"; }; nested() { eval "$1"; }; ${entry.source}`);
  assert.equal(expected.status, entry.status);
  assert.deepEqual(expected.stdout, Buffer.from(entry.stdout));
  assert.deepEqual(expected.stderr, Buffer.alloc(0));
});

test("pinned Bash mapfile callback exits the current shell without continuing", nativeOptions(), () => {
  const expected = runNative("callback() { exit 7; }; mapfile -C callback -c 1 cells; printf after", "record\n");
  assert.equal(expected.status, 7);
  assert.deepEqual(expected.stdout, Buffer.alloc(0));
  assert.deepEqual(expected.stderr, Buffer.alloc(0));
});

for (const callback of [false, true]) test(`evaluation exit: held ${callback ? "callback" : "literal"} cleanup waits for unwind and public completion waits for drain`, { timeout: 2500 }, async () => {
  const subject = setup({ held: true });
  let settled = false;
  const pending = subject.shell.exec(callback ? "callback() { exit 7; }; probe callback; printf after" : "probe 'exit 7'; printf after");
  void pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await bounded(subject.cleanupStarted.promise, "cleanup start");
    await turn();
    assert.equal(settled, false, "public completion must join the held owned cleanup");
    const activeAtCleanup = [...subject.active];
    subject.cleanupGate.resolve();
    const result = await bounded(pending, "held cleanup completion");
    assert.equal(result.exitCode, 7, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.equal(subject.retired.length, 1);
    assert.equal(subject.active.size, 0);
    assert.deepEqual(activeAtCleanup, [], subject.events.join(" -> "));
    assert.deepEqual(subject.early, []);
  } finally { subject.cleanupGate.resolve(); await bounded(pending.catch(() => {}), "pending evaluation retirement"); await subject.close(); }
});

test("evaluation exit: subshell exit stays local and evaluation returns normally", { timeout: 2500 }, async () => {
  const subject = setup();
  try {
    const result = await bounded(subject.shell.exec("probe '(exit 7); printf child-done'; printf after"), "subshell control");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "child-doneafter");
    assert.equal(result.stderr, "");
    assert.deepEqual(subject.returned, ["probe:1"]);
    assert.deepEqual(subject.retired, ["probe:1"]);
    assert.deepEqual(subject.early, [], subject.events.join(" -> "));
  } finally { await subject.close(); }
});

for (const callback of [false, true]) for (const reason of [false, null, 0, ""]) {
  test(`evaluation exit: root cancellation ${JSON.stringify(reason)} outranks ${callback ? "callback" : "literal"} exit and cleanup failure`, { timeout: 2500 }, async () => {
    const cleanupFailure = new Error("owned drain failure after release");
    const subject = setup({ held: true, cleanupFailure });
    const controller = new AbortController();
    let settled = false;
    const source = callback ? "callback() { exit 7; }; probe callback; printf after" : "probe 'exit 7'; printf after";
    const outcome = subject.shell.exec(source, { signal: controller.signal }).then(
      value => { settled = true; return { kind: "return" as const, value }; },
      error => { settled = true; return { kind: "throw" as const, error }; },
    );
    try {
      await bounded(subject.cleanupStarted.promise, "cleanup before cancellation");
      controller.abort(reason);
      await turn();
      assert.equal(settled, false, "cancellation must not bypass an enrolled drain");
      subject.cleanupGate.resolve();
      const result = await bounded(outcome, "cancelled evaluation");
      assert.equal(result.kind, "throw");
      if (result.kind === "throw") assert.ok(Object.is(result.error, reason), "preserve exact falsey root reason");
      assert.equal(subject.retired.length, 1);
      assert.equal(subject.active.size, 0);
    } finally { subject.cleanupGate.resolve(); await bounded(outcome, "cancelled retirement"); await subject.close(); }
  });
}
