import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { extensionState, type ShellExtensionBuiltin } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";

function setup(builtins: readonly ShellExtensionBuiltin[]) {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "replacement", create: () => ({ builtins }) }] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const replace of [undefined, false]) test(`core collisions still reject without explicit replacement: ${String(replace)}`, async context => {
  let executed = false;
  const shell = setup([{ name: "read", ...(replace === undefined ? {} : { replace }), execute() { executed = true; return 0; } }]);
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("read"), /conflicts/u);
  assert.equal(executed, false);
});

for (const name of ["read", "command", "builtin", "type"]) for (const prefix of ["", "command ", "builtin "]) test(`explicit replacement resolves ${prefix}${name}`, async context => {
  const calls: string[][] = [];
  const shell = setup([{ name, replace: true, execute(command) { calls.push([command.command, ...command.args]); return 7; } }]);
  context.after(() => shell.dispose());
  const result = await shell.exec(`${prefix}${name} operand`);
  assert.equal(result.exitCode, 7, result.stderr);
  assert.equal(result.stderr, "");
  const wrapsItself = prefix.trim() === name;
  assert.deepEqual(calls, [[name, ...(wrapsItself ? [name] : []), "operand"]]);
});

test("replacement discovery retains function precedence and explicit builtin bypass", async context => {
  const calls: string[] = [];
  const shell = setup([{ name: "read", replace: true, execute(command) { calls.push(command.command); return 0; } }]);
  context.after(() => shell.dispose());
  const result = await shell.exec('read() { printf function; }; read; command read; builtin read; type -a read; command -v read');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(calls, ["read", "read"]);
  assert.match(result.stdout, /^functionread is a function/u);
  assert.match(result.stdout, /read is a shell builtin/u);
  assert.ok(result.stdout.endsWith("read\n"));
});

test("replacement metadata is captured once without losing a private method receiver", async context => {
  let reads = 0;
  class Builtin {
    readonly name = "read";
    readonly #status = 6;
    get replace() { return ++reads === 1; }
    execute() { return this.#status; }
  }
  const shell = setup([new Builtin()]);
  context.after(() => shell.dispose());
  const result = await shell.exec("read; read");
  assert.equal(result.exitCode, 6, result.stderr);
  assert.equal(reads, 1);
});

for (const replace of [null, 1, "true", {}]) test(`invalid replacement metadata rejects: ${String(replace)}`, () => {
  assert.throws(() => extensionState([{ name: "invalid", create: () => ({ builtins: [{ name: "read", replace: replace as boolean, execute: () => 0 }] }) }]), /replacement/u);
});

test("explicit replacement never permits duplicate extension builtins", () => {
  assert.throws(() => extensionState([{ name: "duplicate", create: () => ({ builtins: [
    { name: "read", replace: true, execute: () => 0 }, { name: "read", replace: true, execute: () => 0 },
  ] }) }]), /duplicate/u);
});

test("inherited replacement is snapshotted before later definition mutation", async context => {
  const prototype = { replace: true };
  const builtin = Object.assign(Object.create(prototype) as ShellExtensionBuiltin, { name: "read", execute: () => 5 });
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "snapshot", create: () => ({
    builtins: [builtin], start() { prototype.replace = false; },
  }) }] });
  context.after(() => shell.dispose());
  const result = await shell.exec("read; read");
  assert.equal(result.exitCode, 5, result.stderr);
  assert.equal(result.stderr, "");
});

test("replacement permission does not cross independent extension definitions", () => {
  assert.throws(() => extensionState(["first", "second"].map(name => ({ name, create: () => ({ builtins: [{ name: "read", replace: true, execute: () => 0 }] }) }))), /duplicate/u);
});

for (const name of ["command", "builtin"]) test(`replacement ${name} owns its declaration expansion rather than acting as a wrapper`, async context => {
  const calls: string[][] = [];
  const shell = setup([{ name, replace: true, expansion: "declaration", execute(command) { calls.push([...command.args]); return 0; } }]);
  context.after(() => shell.dispose());
  const result = await shell.exec(`value='a b'; ${name} field=$value`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(calls, [["field=a b"]]);
});

test("ordinary replacement does not inherit core declaration expansion", async context => {
  const calls: string[][] = [];
  const shell = setup([{ name: "export", replace: true, execute(command) { calls.push([...command.args]); return 0; } }]);
  context.after(() => shell.dispose());
  const result = await shell.exec("value='a b'; export field=$value");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(calls, [["field=a", "b"]]);
});
