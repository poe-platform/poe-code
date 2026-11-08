import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { streamCommands } from "../../../../src/commands/streams.js";
import type { ShellValue } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function setup(hooks: {
  readonly readiness?: "ready" | "blocked";
  readonly beforeProbe?: () => Promise<void>;
  readonly beforeRelease?: () => Promise<void>;
  readonly diagnostic?: (message: ShellValue) => Promise<void>;
} = {}) {
  const events: string[] = [];
  const failures: unknown[] = [];
  const definition = readExtension();
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
      const input = invocation.input;
      return Promise.resolve(builtin.execute({ ...invocation,
        bindings: { ...invocation.bindings,
          async assign(name, value) { events.push("assign"); await invocation.bindings.assign(name, value); },
          async openIndexed(name, options) { events.push("indexed"); return invocation.bindings.openIndexed(name, options); },
        },
        async diagnostic(message) {
          events.push("diagnostic");
          if (hooks.diagnostic) await hooks.diagnostic(message);
          else await invocation.diagnostic(message);
        },
        input: {
          validateOpen(descriptor) { assert.equal(descriptor, 3); events.push("validate"); input.validateOpen(descriptor); },
          borrow(descriptor) { assert.equal(descriptor, 3); events.push("borrow"); return input.borrow(descriptor); },
          observe(descriptor) {
            assert.equal(descriptor, 3);
            events.push("observe");
            const observer = input.observe(descriptor);
            assert.equal(observer.readable, false);
            return { readable: observer.readable,
              async probeRead() { events.push("probe"); await hooks.beforeProbe?.(); return { readiness: hooks.readiness ?? "ready", timeout: "unknown" as const }; },
              waitRead() { throw new Error("Unknown waiting policy must never start a wait"); },
              async release() { events.push("release"); await hooks.beforeRelease?.(); await observer.release(); },
            };
          },
        },
      })).catch(reason => { failures.push(reason); throw reason; });
    } })) };
  } }] });
  for (const command of basicCommands()) shell.register(command);
  const cat = streamCommands().find(command => command.name === "cat");
  assert.ok(cat);
  shell.register(cat);
  return { shell, events, failures };
}

function program(args: string, inherited = ""): string {
  return `value=OLD; fixed=LOCK; values=(KEEP STAY); readonly fixed; ${inherited} read -r ${args} 3>/out; result=$?; printf '%s:<%s>:<%s>:<%s>;' "$result" "$value" "$fixed" "\${values[*]}"; cat`;
}

for (const timing of ["explicit", "TMOUT"] as const) for (const target of ["value", "-a values", "fixed", "-a bad-name"]) {
  test(`unreadable ready/unknown ${timing} preserves target before EBADF: ${target}`, async context => {
    const subject = setup();
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(program(`${timing === "explicit" ? "-t.02 " : ""}-u3 ${target}`, timing === "TMOUT" ? "TMOUT=.02;" : ""), { stdin: Buffer.from("first word\nsecond tail\n") });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1:<OLD>:<LOCK>:<KEEP STAY>;first word\nsecond tail\n");
    assert.equal(result.stderr, "shell: line 1: read: 3: read error: Bad file descriptor\n");
    assert.deepEqual(subject.events, ["validate", "borrow", "observe", "probe", "diagnostic", "release"]);
  });
}

for (const entry of [
  { args: "-t.02 -u3 -n0 value", output: "1:<>:<LOCK>:<KEEP STAY>;", events: ["validate", "borrow", "assign"] },
  { args: "-u3 -N0 -a values", output: "1:<OLD>:<LOCK>:<>;", events: ["validate", "borrow", "indexed"] },
  { args: "-t0 -u3 -n0 fixed", output: "0:<OLD>:<LOCK>:<KEEP STAY>;", events: ["validate", "observe", "probe", "release"] },
  { args: "-t0 -u3 -N0 -a bad-name", output: "0:<OLD>:<LOCK>:<KEEP STAY>;", events: ["validate", "observe", "probe", "release"] },
]) test(`ready/unknown zero-count and zero-timeout control: ${entry.args}`, async context => {
  const subject = setup();
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(program(entry.args, "TMOUT=.02;"));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, entry.output);
  assert.equal(result.stderr, "");
  assert.deepEqual(subject.events, entry.events);
});

for (const timing of ["explicit", "TMOUT"] as const) test(`blocked/unknown ${timing} still refuses without assigning`, async context => {
  const subject = setup({ readiness: "blocked" });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec(program(`${timing === "explicit" ? "-t.02 " : ""}-u3 -a values`, timing === "TMOUT" ? "TMOUT=.02;" : ""));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1:<OLD>:<LOCK>:<KEEP STAY>;");
  assert.equal(result.stderr, "shell: line 1: read: descriptor timeout observation unavailable through this extension API\n");
  assert.deepEqual(subject.events, ["validate", "borrow", "observe", "probe", "diagnostic", "release"]);
});

test("readable ready input with unknown provenance still refuses a positive multiline deadline", async context => {
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 });
  let pulls = 0;
  const source = new ShellInput({ async *[Symbol.asyncIterator]() { pulls++; yield Buffer.from("first\nsecond\n"); } }, budget, budget.signal, { provenance: "unknown", poll: () => "ready" });
  const failures: unknown[] = [];
  const shell = new Shell({ fs: createMemoryFileSystem(), onInternalError: reason => { failures.push(reason); }, extensions: [readExtension()] });
  context.after(async () => {
    try { await shell.dispose(); await source.close(); }
    finally { budget.close(); budget.values.close(); }
  });
  const result = await shell.exec("read -t.02 -N12 value", { stdin: source });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.equal(failures.length, 1);
  assert.ok(failures[0] instanceof TypeError);
  assert.equal(failures[0].message, "Read timeout requires explicit input provenance");
  assert.equal(pulls, 0);
});

test("ready/unknown EBADF diagnostic preserves false and drains the acquired observer", async context => {
  const closing = deferred();
  const release = deferred();
  let message: ShellValue | undefined;
  let settled = false;
  const subject = setup({ diagnostic: async value => { message = value; throw false; }, beforeRelease: async () => { closing.resolve(); await release.promise; } });
  context.after(() => subject.shell.dispose());
  const execution = subject.shell.exec("read -t.02 -u3 value 3>/out").then(result => ({ result }), reason => ({ reason })).finally(() => { settled = true; });
  await Promise.race([closing.promise, execution.then(() => { throw new Error("Observer cleanup was not entered"); })]);
  try { assert.equal(settled, false); assert.equal(message, "read: 3: read error: Bad file descriptor"); }
  finally { release.resolve(); }
  const result = await execution;
  assert.ok("result" in result);
  assert.equal(result.result.exitCode, 1);
  assert.deepEqual(subject.failures, [false]);
  assert.deepEqual(subject.events, ["validate", "borrow", "observe", "probe", "diagnostic", "release"]);
});

test("root false cancellation after ready probe wins and drains without a diagnostic or assignment", async context => {
  const entered = deferred();
  const probe = deferred();
  const closing = deferred();
  const release = deferred();
  const controller = new AbortController();
  let settled = false;
  const subject = setup({ beforeProbe: async () => { entered.resolve(); await probe.promise; }, beforeRelease: async () => { closing.resolve(); await release.promise; } });
  context.after(() => subject.shell.dispose());
  const execution = subject.shell.exec("read -t.02 -u3 value 3>/out", { signal: controller.signal }).then(result => ({ result }), reason => ({ reason })).finally(() => { settled = true; });
  await Promise.race([entered.promise, execution.then(() => { throw new Error("Observer probe was not entered"); })]);
  controller.abort(false);
  probe.resolve();
  await Promise.race([closing.promise, execution.then(() => { throw new Error("Observer cleanup was not entered"); })]);
  try { assert.equal(settled, false); }
  finally { release.resolve(); }
  const result = await execution;
  assert.ok("reason" in result);
  assert.equal(result.reason, false);
  assert.deepEqual(subject.events, ["validate", "borrow", "observe", "probe", "release"]);
});
