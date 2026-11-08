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

function bounded<Value>(work: Promise<Value>, label: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: owned drain cycle exceeded observation bound`)), 750);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

function setup(options: { readonly held?: boolean; readonly failure?: { readonly reason: unknown } } = {}) {
  const rescue = deferred();
  const gate = deferred();
  const started = deferred();
  if (!options.held) gate.resolve();
  const events: string[] = [];
  const active = new Set<number>();
  const early: number[] = [];
  const closed: number[] = [];
  const returned: number[] = [];
  let sequence = 0;
  const execute = async (context: ShellExtensionContext): Promise<number> => {
    const identity = ++sequence;
    const unwound = deferred();
    active.add(identity);
    events.push(`enter:${identity}`);
    context.registerCleanup(async () => {
      events.push(`close:${identity}`);
      if (active.has(identity)) early.push(identity);
      await Promise.race([unwound.promise, rescue.promise]);
      started.resolve();
      await gate.promise;
      closed.push(identity);
      events.push(`closed:${identity}`);
      if (options.failure) throw options.failure.reason;
    });
    try {
      const status = await context.evaluate(context.argumentValues[0] ?? "");
      returned.push(identity);
      return status;
    } finally {
      active.delete(identity);
      events.push(`unwind:${identity}`);
      unwound.resolve();
    }
  };
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [
    trapExtension(),
    { name: "owned-evaluation-review", create: () => ({ builtins: [{ name: "own", execute }, { name: "nested", execute }] }) },
  ] });
  for (const command of basicCommands()) shell.register(command);
  return { shell, rescue, gate, started, events, active, early, closed, returned };
}

const cases = [
  { name: "literal exit control", source: "own 'exit 7'; printf after", status: 7, bytes: Buffer.alloc(0), owners: 1, returned: 0 },
  { name: "callback exit with cleanup joining evaluator unwind", source: "callback() { exit 7; }; own callback; printf after", status: 7, bytes: Buffer.alloc(0), owners: 1, returned: 0 },
  { name: "nested evaluators with both drains joining unwind", source: "callback() { exit 7; }; own 'nested callback'; printf after", status: 7, bytes: Buffer.alloc(0), owners: 2, returned: 0 },
  { name: "EXIT replacement evaluator retains raw callback local", source: `value=outer; trap 'printf "<%s>:%s;" "$value" "$?"; nested "exit 9"' EXIT; callback() { local value=$'\\xff'; exit 7; }; own callback; printf after`, status: 9, bytes: Buffer.from([60, 255, 62, 58, 55, 59]), owners: 2, returned: 0 },
  { name: "subshell exit leaves the outer evaluator and later sibling active", source: "callback() { exit 7; }; own '(nested callback); printf parent'; printf sibling", status: 0, bytes: Buffer.from("parentsibling"), owners: 2, returned: 1 },
  { name: "pipeline exit does not drain a sibling evaluator", source: "callback() { exit 7; }; own callback | nested 'printf sibling'", status: 0, bytes: Buffer.from("sibling"), owners: 2, returned: 1 },
] as const;

for (const entry of cases) {
  test(`evaluation drain review: ${entry.name}`, { timeout: 2500 }, async () => {
    const subject = setup();
    const pending = subject.shell.exec(entry.source);
    void pending.catch(() => {});
    try {
      const result = await bounded(pending, entry.name);
      assert.equal(result.exitCode, entry.status, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), entry.bytes);
      assert.deepEqual(result.stderrBytes, new Uint8Array());
      assert.deepEqual(subject.early, [], subject.events.join(" -> "));
      assert.equal(subject.active.size, 0);
      assert.equal(subject.closed.length, entry.owners);
      assert.equal(new Set(subject.closed).size, entry.owners);
      assert.equal(subject.returned.length, entry.returned);
    } finally {
      subject.rescue.resolve(); subject.gate.resolve();
      await bounded(pending.catch(() => {}), "review retirement");
      await bounded(subject.shell.dispose(), "review disposal");
    }
  });

  test(`pinned Bash evaluation drain review: ${entry.name}`, nativeOptions(), () => {
    const result = runNative(`own() { eval "$1"; }; nested() { eval "$1"; }; ${entry.source}`);
    assert.equal(result.status, entry.status);
    assert.deepEqual(result.stdout, entry.bytes);
    assert.deepEqual(result.stderr, Buffer.alloc(0));
  });
}

for (const reason of [undefined, null, false, 0, ""]) test(`evaluation drain review preserves falsey cleanup failure ${String(reason)}`, { timeout: 2500 }, async () => {
  const subject = setup({ failure: { reason } });
  const pending = subject.shell.exec("own 'exit 7'");
  try {
    await assert.rejects(bounded(pending, "falsey cleanup"), error => Object.is(error, reason));
    assert.deepEqual(subject.early, []);
    assert.deepEqual(subject.closed, [1]);
    assert.equal(subject.active.size, 0);
  } finally {
    subject.rescue.resolve(); subject.gate.resolve();
    await bounded(pending.catch(() => {}), "falsey retirement");
    await bounded(subject.shell.dispose(), "falsey disposal");
  }
});

for (const reason of [null, false, 0, ""]) test(`evaluation drain review root cancellation outranks held falsey cleanup: ${String(reason)}`, { timeout: 2500 }, async () => {
  const subject = setup({ held: true, failure: { reason: undefined } });
  const controller = new AbortController();
  let settled = false;
  const outcome = subject.shell.exec("own 'exit 7'", { signal: controller.signal }).then(
    value => { settled = true; return { kind: "return" as const, value }; },
    error => { settled = true; return { kind: "throw" as const, error }; },
  );
  try {
    await bounded(subject.started.promise, "held cleanup start");
    controller.abort(reason);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(subject.active.size, 0);
    subject.gate.resolve();
    const result = await bounded(outcome, "cancelled held cleanup");
    assert.equal(result.kind, "throw");
    if (result.kind === "throw") assert.ok(Object.is(result.error, reason));
    assert.deepEqual(subject.closed, [1]);
    assert.deepEqual(subject.early, []);
  } finally {
    subject.rescue.resolve(); subject.gate.resolve();
    await bounded(outcome, "cancelled retirement");
    await bounded(subject.shell.dispose(), "cancelled disposal");
  }
});
