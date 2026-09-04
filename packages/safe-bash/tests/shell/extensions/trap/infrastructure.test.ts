import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { extensionState, forkExtensions, type ShellExtension, type ShellExtensionEvent } from "../../../../src/shell/extensions.js";
import { commandRuntimeIdentity } from "../../../../src/contracts/command.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";

test("extension definition snapshots preserve class factory receivers", async context => {
  class Definition implements ShellExtension {
    readonly name = "class-factory";
    readonly runtimeIdentity = commandRuntimeIdentity;
    readonly #status = 7;
    create() {
      const status = this.#status;
      return { builtins: [{ name: "private-status", execute: () => status }] };
    }
  }
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [new Definition()] });
  context.after(() => shell.dispose());
  const result = await shell.exec("private-status");
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, "");
});

test("runtime-affine extensions retain exact identity across monitored shell forks", async context => {
  const extension: ShellExtension = {
    name: "identity", runtimeIdentity: commandRuntimeIdentity,
    create() {
      assert.equal(this.runtimeIdentity, commandRuntimeIdentity);
      return { builtins: [] };
    },
  };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension] });
  context.after(() => shell.dispose());
  const result = await shell.exec(": | :; (:); value=$(:); bash -c ':'");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
});

test("generic extensions need no trap implementation and keep per-exec state", async context => {
  const events: ShellExtensionEvent[] = [];
  let created = 0, closed = 0;
  const extension: ShellExtension = { name: "counter", create() {
    created++;
    let calls = 0;
    return {
      builtins: [{ name: "count", async execute(context) {
        await context.stdout.write(new TextEncoder().encode(String(++calls)));
        return 0;
      } }],
      start(context) { context.registerCleanup(() => { closed++; }); },
      event(event) { events.push(event); },
    };
  } };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension] });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("count; builtin count; command count")).stdout, "123");
  assert.equal((await shell.exec("count")).stdout, "1");
  assert.equal(created, 2);
  assert.equal(closed, 2);
  assert.equal(events.filter(event => event === "exit").length, 2);
  assert.equal((await shell.exec("command -v trap")).exitCode, 1);
});

test("generic named and short options agree with conditionals and listings", async context => {
  const extension: ShellExtension = { name: "option", create() {
    return { builtins: [], options: [{ name: "custom", flag: "Z", enabled: false }] };
  } };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension] });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec("set -Z; [[ -o custom ]]; printf '%s;' $?; set -o; set +o custom; [[ -o custom ]]; printf '%s' $?");
  assert.equal(result.stdout, "0;errexit\toff\nnounset\toff\npipefail\toff\ncustom\ton\n1");
  assert.equal(result.stderr, "");
});

test("extension array is snapshotted without adding default builtins", async context => {
  const extensions: ShellExtension[] = [];
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions });
  context.after(() => shell.dispose());
  extensions.push({ name: "late", create: () => ({ builtins: [{ name: "late", execute: () => 0 }] }) });
  assert.equal((await shell.exec("command -v late")).exitCode, 1);
});

for (const option of [
  { name: "pipefail", enabled: false },
  { name: "custom", flag: "e", enabled: false },
  { name: "custom", flag: "o", enabled: false },
]) test(`reserved extension option is rejected: ${option.flag ?? option.name}`, () => {
  assert.throws(() => extensionState([{ name: "reserved", create: () => ({ builtins: [], options: [option] }) }]), TypeError);
});

test("duplicate short option flags are rejected", () => {
  assert.throws(() => extensionState([{ name: "duplicates", create: () => ({ builtins: [], options: [
    { name: "first", flag: "Z", enabled: false }, { name: "second", flag: "Z", enabled: false },
  ] }) }]), TypeError);
});

test("existing builtin collisions reject before executing extension source", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [{ name: "collision", create: () => ({ builtins: [{ name: "exit", execute: () => 0 }] }) }] });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec(":"), /Extension builtin conflicts/);
});

test("special extension builtins retain sh definition restrictions", async context => {
  const extension: ShellExtension = { name: "special", create: () => ({ builtins: [{ name: "reserved", special: true, execute: () => 0 }] }) };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension] });
  context.after(() => shell.dispose());
  const result = await shell.exec(`sh -c 'reserved() { :; }; :'`);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /reserved.*special builtin/);
});

for (const primary of [false, 0, "", null]) test(`extension completion retains falsey primary failure with cleanup failure: ${String(primary)}`, async context => {
  const secondary = new Error("cleanup failure");
  let cleaned = 0;
  const extension: ShellExtension = { name: "failure", create: () => ({
    builtins: [],
    start(context) { context.registerCleanup(() => { cleaned++; throw secondary; }); },
    event(event) { if (event === "exit") throw primary; },
  }) };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension] });
  context.after(() => shell.dispose());
  const contains = (error: unknown, wanted: unknown): boolean => error === wanted || error instanceof AggregateError && error.errors.some(item => contains(item, wanted));
  await assert.rejects(shell.exec(":"), error => contains(error, primary) && contains(error, secondary));
  assert.equal(cleaned, 1);
});

test("trap definitions declare their exact command runtime identity", () => {
  assert.equal(trapExtension().runtimeIdentity, commandRuntimeIdentity);
});

test("extension affinity preflights every definition before any factory or startup", async context => {
  let created = 0, started = 0;
  const first: ShellExtension = { name: "local", create() { created++; return { builtins: [], start() { started++; } }; } };
  const second = { name: "foreign", runtimeIdentity: {}, create() { created++; return { builtins: [] }; } };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [first, second] });
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec(":"), /matching shell runtime/);
  assert.equal(created, 0);
  assert.equal(started, 0);
});

test("inherited foreign extension affinity cannot disappear during capture", () => {
  let created = 0;
  const definition = Object.assign(Object.create({ runtimeIdentity: {} }) as ShellExtension, {
    name: "inherited", create() { created++; return { builtins: [] }; },
  });
  assert.throws(() => extensionState([definition]), /matching shell runtime/);
  assert.equal(created, 0);
});

test("inherited matching extension identity is captured as own immutable data", () => {
  const definition = Object.assign(Object.create({ runtimeIdentity: commandRuntimeIdentity }) as ShellExtension, { name: "matching", create: () => ({ builtins: [] }) });
  const captured = extensionState([definition])!.entries[0]!.definition;
  assert.equal(captured.runtimeIdentity, commandRuntimeIdentity);
  assert.equal(Object.hasOwn(captured, "runtimeIdentity"), true);
  assert.equal(Object.isFrozen(captured), true);
});

test("extension identity is captured once while factories retain their original receiver", () => {
  let reads = 0;
  const foreign = {};
  const definition: ShellExtension = {
    name: "changing",
    get runtimeIdentity() { return ++reads === 1 ? commandRuntimeIdentity : foreign; },
    create() { assert.equal(this, definition); return { builtins: [] }; },
  };
  const state = extensionState([definition])!;
  assert.equal(reads, 1);
  assert.equal(state.entries[0]!.definition.runtimeIdentity, commandRuntimeIdentity);
  forkExtensions(state, "subshell");
  assert.equal(reads, 1);
});

test("mutable original extension definitions cannot replace captured fork factories", () => {
  let originalCalls = 0, replacementCalls = 0;
  const definition = { name: "original", runtimeIdentity: commandRuntimeIdentity, create() { originalCalls++; return { builtins: [] }; } };
  const state = extensionState([definition])!;
  definition.name = "replacement";
  definition.runtimeIdentity = {};
  definition.create = () => { replacementCalls++; return { builtins: [] }; };
  const child = forkExtensions(state, "subshell")!;
  assert.equal(child.entries[0]!.definition.name, "original");
  assert.equal(child.entries[0]!.definition.runtimeIdentity, commandRuntimeIdentity);
  assert.equal(originalCalls, 2);
  assert.equal(replacementCalls, 0);
});

test("foreign later definitions reject before an earlier instance fork", () => {
  let forked = 0;
  const first: ShellExtension = { name: "local", create: () => ({ builtins: [], fork() { forked++; return { builtins: [] }; } }) };
  const parent = extensionState([first])!;
  const foreign = { name: "foreign", runtimeIdentity: {}, create: () => ({ builtins: [] }) };
  assert.throws(() => extensionState([first, foreign], parent, "subshell"), /matching shell runtime/);
  assert.equal(forked, 0);
});
