import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { commandRuntimeIdentity } from "../../../../src/contracts/command.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { extensionState, type ShellExtension, type ShellExtensionBuiltin } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";

function setup(extensions: readonly ShellExtension[]) {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const expansion of ["ordinary", "declaration"] as const) for (const prefix of ["", "command -- ", "builtin -- "]) {
  test(`replacement review: ${prefix}export honors captured ${expansion} expansion`, async () => {
    const calls: string[][] = [];
    const shell = setup([{ name: "replace-export", runtimeIdentity: commandRuntimeIdentity, create: () => ({ builtins: [{
      name: "export", replace: true, expansion, execute(context) { calls.push([...context.args]); return 0; },
    }] }) }]);
    try {
      const result = await shell.exec(`value='a b'; ${prefix}export item=$value`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(calls, [expansion === "declaration" ? ["item=a b"] : ["item=a", "b"]]);
      assert.equal(result.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("replacement review: simultaneous discovery replacements own their operands rather than recursively bypassing", async () => {
  const calls: string[][] = [];
  const shell = setup([{ name: "replace-discovery", create: () => ({ builtins: ["read", "command", "builtin", "type"].map(name => ({
    name, replace: true, execute(context) { calls.push([context.command, ...context.args]); return 0; },
  })) }) }]);
  try {
    const result = await shell.exec("command builtin read payload; builtin command read payload; type -t read; read end");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(calls, [["command", "builtin", "read", "payload"], ["builtin", "command", "read", "payload"], ["type", "-t", "read"], ["read", "end"]]);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("replacement review: function precedence and builtin discovery agree with explicit bypass", async () => {
  const calls: string[] = [];
  const shell = setup([{ name: "replace-read", create: () => ({ builtins: [{ name: "read", replace: true,
    execute(context) { calls.push(context.command); return 0; },
  }] }) }]);
  try {
    const result = await shell.exec('type -t read; command -v read; builtin type -t read; read() { printf F; }; type -t read; read; command -- read; builtin -- read');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "builtin\nread\nbuiltin\nfunction\nF");
    assert.equal(result.stderr, "");
    assert.deepEqual(calls, ["read", "read"]);
  } finally { await shell.dispose(); }
});

test("replacement review: mutation after frame capture cannot revoke permission or change private execute receiver", async () => {
  const captures = { replace: 0, expansion: 0, execute: 0 };
  class Replacement {
    readonly name = "read";
    readonly #status = 7;
    enabled = true;
    get replace() { captures.replace++; return this.enabled; }
    get expansion(): "declaration" { captures.expansion++; return "declaration"; }
    get execute() { captures.execute++; return this.run; }
    run() { return this.#status; }
  }
  const builtin = new Replacement();
  const shell = setup([{ name: "captured-read", create: () => ({ builtins: [builtin], start() { builtin.enabled = false; } }) }]);
  try {
    const result = await shell.exec("read; command read; builtin read");
    assert.equal(result.exitCode, 7, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(captures, { replace: 1, expansion: 1, execute: 1 });
  } finally { await shell.dispose(); }
});

test("replacement review: replacement authority is revalidated for forked frames", async () => {
  let executions = 0;
  const shell = setup([{ name: "forked-read", create: () => ({
    builtins: [{ name: "read", replace: true, execute() { executions++; return 0; } }],
    fork() { return { builtins: [{ name: "read", execute() { executions++; return 0; } }] }; },
  }) }]);
  try {
    const failures: unknown[] = [];
    const result = await shell.exec("(read)", { onInternalError(error) { failures.push(error); } });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "shell: line 1: internal error\n");
    assert.equal(failures.length, 1);
    assert.ok(failures[0] instanceof TypeError);
    assert.equal(failures[0].message, "Extension builtin conflicts with existing builtin: read");
    assert.equal(executions, 0);
  } finally { await shell.dispose(); }
});

for (const acrossDefinitions of [false, true]) {
  test(`replacement review: duplicate extension builtin cannot be rescued by replace=true; separate=${acrossDefinitions}`, () => {
    const first: ShellExtensionBuiltin = { name: "read", replace: true, execute: () => 0 };
    const second: ShellExtensionBuiltin = { name: "read", replace: true, execute: () => 0 };
    const definitions: ShellExtension[] = acrossDefinitions
      ? [{ name: "first", create: () => ({ builtins: [first] }) }, { name: "second", create: () => ({ builtins: [second] }) }]
      : [{ name: "same", create: () => ({ builtins: [first, second] }) }];
    assert.throws(() => extensionState(definitions), /duplicate extension builtin/);
  });
}

test("replacement review: explicit replacement cannot bypass runtime identity admission", () => {
  let created = false;
  assert.throws(() => extensionState([{ name: "foreign-read", runtimeIdentity: {}, create() {
    created = true;
    return { builtins: [{ name: "read", replace: true, execute: () => 0 }] };
  } }]), /matching shell runtime/);
  assert.equal(created, false);
});

test("replacement review: omitted permission rejects before extension start or input consumption", async () => {
  let starts = 0, pulls = 0;
  const shell = setup([{ name: "unapproved-read", create: () => ({
    builtins: [{ name: "read", replace: false, execute: () => 0 }], start() { starts++; },
  }) }]);
  try {
    await assert.rejects(shell.exec("read", { stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(65); } } }), /conflicts with existing builtin/);
    assert.deepEqual({ starts, pulls }, { starts: 0, pulls: 0 });
  } finally { await shell.dispose(); }
});
