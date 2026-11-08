import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { FsError } from "../../../../src/contracts/errors.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellInputObserver } from "../../../../src/shell/extensions.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { Shell } from "../../../../src/shell/shell.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

for (const args of ["-t0 -u3 value", "-t0 -u3 bad-name", "-t0 -u3 -n0 value", "-N0 -u3 -t0 -a values"]) {
  test(`retained regular observer bypasses assignment and read acquisition: ${args}`, async context => {
    const fs = createMemoryFileSystem();
    const definition = readExtension();
    const events: string[] = [];
    const shell = new Shell({ fs, extensions: [{ ...definition, create() {
      const instance = definition.create();
      return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
        const input = invocation.input;
        return builtin.execute({ ...invocation, input: {
          validateOpen: input.validateOpen.bind(input),
          borrow() { throw new Error("A zero-timeout probe must not borrow input"); },
          observe(descriptor) {
            assert.equal(descriptor, 3);
            const observer = input.observe(descriptor);
            events.push("observe");
            return { readable: observer.readable,
              async probeRead() { events.push("probe"); return observer.probeRead(); },
              waitRead() { throw new Error("Zero timeout must not wait"); },
              async release() { events.push("release"); await observer.release(); },
            };
          },
        } });
      } })) };
    } }] });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    await fs.writeFile("/out", Uint8Array.of(255, 10));
    const result = await shell.exec(`value=OLD; values=(old keep); readonly value values; read ${args} 3>>/out; printf '%s:<%s>:<%s>' "$?" "$value" "\${values[*]}"`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "0:<OLD>:<old keep>");
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/out"), Uint8Array.of(255, 10));
    assert.deepEqual(events, ["observe", "probe", "release"]);
  });
}

for (const entry of [
  { args: "-t.02 -u3 value", stdout: "142:<>:<old keep>", stderr: "" },
  { args: "-t.02 -u3 -a values", stdout: "142:<OLD>:<>", stderr: "" },
  { args: "-t.02 -u3 -a bad-name", stdout: "1:<OLD>:<old keep>", stderr: "shell: line 1: read: `bad-name': not a valid identifier\n" },
  { args: "-u3 value", before: "TMOUT=.02;", stdout: "142:<>:<old keep>", stderr: "" },
]) test(`injected observer timeout assigns without fabricating a readable cursor: ${entry.args}`, async context => {
  const events: string[] = [];
  const definition = readExtension();
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
      return builtin.execute({ ...invocation, input: {
        validateOpen(descriptor) { assert.equal(descriptor, 3); events.push("validate"); },
        borrow(descriptor) { assert.equal(descriptor, 3); events.push("borrow"); throw new FsError("EBADF"); },
        observe(descriptor): ShellInputObserver {
          assert.equal(descriptor, 3);
          events.push("observe");
          return { readable: false,
            async probeRead() { events.push("probe"); return { readiness: "blocked", timeout: "honor" }; },
            async waitRead(options) { assert.equal(options.timeoutMs, 20); assert.equal(options.signal, invocation.signal); events.push("wait"); return "timeout"; },
            async release() { events.push("release"); },
          };
        },
      } });
    } })) };
  } }] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(`value=OLD; values=(old keep); ${entry.before ?? ""} read ${entry.args}; printf '%s:<%s>:<%s>' "$?" "$value" "\${values[*]}"`);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, entry.stdout);
  assert.equal(result.stderr, entry.stderr);
  assert.deepEqual(events, ["validate", "borrow", "observe", "probe", "wait", "release"]);
});

test("observer diagnostic failure waits for release and retains false over a secondary failure", async context => {
  const closing = deferred<void>();
  const release = deferred<void>();
  const diagnosticFailure = false;
  const secondary = new Error("secondary release");
  const builtin = readExtension().create().builtins[0]!;
  let observed: { reason: unknown } | undefined;
  let settled = false;
  let releases = 0;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "observer-failure", create: () => ({ builtins: [{ name: "probe", async execute(invocation) {
    try {
      await builtin.execute({ ...invocation, argumentValues: ["-t0"], diagnostic: async () => { throw diagnosticFailure; }, input: {
        validateOpen() { throw new Error("Unexpected explicit validation"); },
        borrow() { throw new Error("Must not borrow a readiness probe"); },
        observe() { return { readable: false, probeRead: async () => ({ readiness: "unknown", timeout: "unknown" }),
          waitRead: async () => { throw new Error("Must not wait"); },
          async release() { releases++; closing.resolve(); await release.promise; throw secondary; },
        }; },
      } });
    } catch (reason) { observed = { reason }; }
    settled = true;
    return 0;
  } }] }) }] });
  context.after(() => shell.dispose());
  const execution = shell.exec("probe").then(result => ({ result }), reason => ({ reason }));
  await Promise.race([closing.promise, execution.then(() => { throw new Error("Invocation settled before observer release"); })]);
  try { assert.equal(settled, false); assert.equal(releases, 1); }
  finally { release.resolve(); }
  const result = await execution;
  assert.ok("reason" in result);
  assert.equal(result.reason, secondary);
  assert.ok(observed);
  assert.equal(observed.reason, diagnosticFailure);
  assert.equal(releases, 1);
});

for (const outcome of ["ready", "unknown"] as const) test(`observer wait ${outcome} does not perform timeout assignment`, async context => {
  const definition = readExtension();
  let releases = 0;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
      return builtin.execute({ ...invocation, input: {
        validateOpen(descriptor) { assert.equal(descriptor, 3); },
        borrow() { throw new FsError("EBADF"); },
        observe() { return { readable: false, probeRead: async () => ({ readiness: "blocked", timeout: "honor" }),
          waitRead: async () => outcome, release: async () => { releases++; },
        }; },
      } });
    } })) };
  } }] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec("value=OLD; read -t.02 -u3 value; printf '%s:<%s>' \"$?\" \"$value\"");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1:<OLD>");
  assert.equal(result.stderr, outcome === "ready"
    ? "shell: line 1: read: 3: read error: Bad file descriptor\n"
    : "shell: line 1: read: descriptor timeout observation unavailable through this extension API\n");
  assert.equal(releases, 1);
});

test("root false cancellation drains an admitted observer wait without assigning timeout data", async context => {
  const waiting = deferred<void>();
  const closing = deferred<void>();
  const release = deferred<void>();
  const controller = new AbortController();
  const definition = readExtension();
  let releases = 0;
  let assignments = 0;
  let settled = false;
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
      return builtin.execute({ ...invocation,
        bindings: { ...invocation.bindings, async assign(name, value) { assignments++; await invocation.bindings.assign(name, value); } },
        input: {
          validateOpen(descriptor) { assert.equal(descriptor, 3); },
          borrow() { throw new FsError("EBADF"); },
          observe() { return { readable: false, probeRead: async () => ({ readiness: "blocked", timeout: "honor" }),
            waitRead(options) {
              assert.equal(options.signal, invocation.signal);
              const pending = new Promise<"timeout">((_resolve, reject) => {
                invocation.signal.addEventListener("abort", () => reject(invocation.signal.reason), { once: true });
              });
              waiting.resolve();
              return pending;
            },
            async release() { releases++; closing.resolve(); await release.promise; },
          }; },
        },
      });
    } })) };
  } }] });
  context.after(() => shell.dispose());
  const execution = shell.exec("read -t.02 -u3 value", { signal: controller.signal }).then(result => ({ result }), reason => ({ reason })).finally(() => { settled = true; });
  await Promise.race([waiting.promise, execution.then(() => { throw new Error("Invocation did not enter observer wait"); })]);
  controller.abort(false);
  await Promise.race([closing.promise, execution.then(() => { throw new Error("Invocation did not drain observer release"); })]);
  try { assert.equal(settled, false); assert.equal(assignments, 0); assert.equal(releases, 1); }
  finally { release.resolve(); }
  const result = await execution;
  assert.ok("reason" in result);
  assert.equal(result.reason, false);
  assert.equal(releases, 1);
  assert.equal(assignments, 0);
});
