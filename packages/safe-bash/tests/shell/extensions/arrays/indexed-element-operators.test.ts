import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { CommandRegistry } from "../../../../src/contracts/command.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { captureShellSyntax, parseShell } from "../../../../src/shell/parser.js";
import type { ShellSyntaxDeclarations } from "../../../../src/shell/parser.js";
import { getArraySelector } from "../../../../src/shell/arrays/syntax.js";
import { Shell } from "../../../../src/shell/shell.js";
import type { ShellResult } from "../../../../src/shell/types.js";
import { ShellLimitError, ShellSyntaxError } from "../../../../src/shell/types.js";
import { nextJobReference } from "../jobs/next53-reference.js";

function fixture(context: TestContext, extensions: readonly ShellExtension[] = [arraysExtension()]) {
  const owner: { shell?: Shell } = {};
  context.after(async () => { await owner.shell?.dispose(); });
  const fs = createMemoryFileSystem();
  const commands = new CommandRegistry(basicCommands());
  const shell = new Shell({ fs, extensions, commands });
  owner.shell = shell;
  return { shell, fs, commands };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("wait23 replays its unchanged indexed source against authenticated Bash5.3 bytes", async context => {
  const reference = nextJobReference(23);
  const { shell } = fixture(context, [arraysExtension(), jobsExtension()]);
  assert.equal(reference.provenance.sourceSHA256, "b18e1b23b1e20fedb6110d9b7087191e2f0162bd8214596d5a99ba392d1df1df");
  assert.equal(reference.request.gates.length, 0);
  const result = await shell.exec(reference.source, { stdin: reference.stdin, env: reference.request.environment });
  assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout, result.stderr);
  assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
  assert.equal(result.exitCode, reference.status);
});

test("wait17 retains indexed source inside an explicit owned VFS descriptor envelope", { timeout: 2500 }, async context => {
  const reference = nextJobReference(17);
  assert.equal(reference.provenance.sourceSHA256, "d745ef2184dd34f9b5bcad735b7a6fddc771f3101ed6949a6b64884c1a3db465");
  assert.deepEqual(reference.request.gates, [{ fd: 3, after: "WAIT_READY", bytesHex: "72656c656173650a" }]);
  const release = deferred();
  const controller = new AbortController();
  const owner: { shell?: Shell; running?: Promise<ShellResult>; timer?: ReturnType<typeof setTimeout> } = {};
  context.after(async () => {
    clearTimeout(owner.timer);
    controller.abort(new Error("indexed wait fixture cleanup"));
    release.resolve();
    await owner.running?.catch(() => undefined);
    await owner.shell?.dispose();
  });
  const memory = createMemoryFileSystem();
  await memory.writeFile("/gate3", Buffer.from(reference.request.gates[0]!.bytesHex, "hex"));
  await memory.writeFile("/control", new Uint8Array());
  const resources: { closes: number }[] = [];
  let control = "";
  let released = false;
  const fs: FileSystem = new Proxy(memory, { get(target, property, receiver) {
    if (property === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      const descriptor = await target.open!(...args);
      const resource = { closes: 0 };
      resources.push(resource);
      return new Proxy(descriptor, { get(retained, member) {
        if (member === "close") return async () => { resource.closes++; await retained.close(); };
        if (member === "read" && args[0] === "/gate3") return async (...operation: Parameters<typeof descriptor.read>) => {
          await release.promise;
          operation[2]?.signal?.throwIfAborted();
          return retained.read(...operation);
        };
        if (member === "write" && args[0] === "/control") return async (...operation: Parameters<typeof descriptor.write>) => {
          const count = await retained.write(...operation);
          control += Buffer.from(operation[0].subarray(0, count)).toString();
          if (control.includes("WAIT_READY\n")) { released = true; release.resolve(); }
          return count;
        };
        const value: unknown = Reflect.get(retained, member, retained);
        return typeof value === "function" ? value.bind(retained) : value;
      } });
    };
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  owner.shell = new Shell({ fs, extensions: [arraysExtension(), jobsExtension()], env: reference.request.environment, commands: new CommandRegistry(basicCommands()) });
  owner.timer = setTimeout(() => { controller.abort(new Error("indexed wait fixture deadline")); release.resolve(); }, 1500);
  owner.running = owner.shell.exec(`{ ${reference.source}; } 3</gate3 7>/control`, { stdin: reference.stdin, signal: controller.signal });
  const result = await owner.running;
  clearTimeout(owner.timer);
  assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout, result.stderr);
  assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
  assert.equal(result.exitCode, reference.status);
  assert.equal(released, true);
  assert.equal(resources.length, 2);
  assert.ok(resources.every(resource => resource.closes === 1));
});

for (const [setup, expected] of [
  ["values=(left right)", "right:x"],
  ["values=(left '')", ":x"],
  ["values=(left)", "fallback:"],
  ["values=scalar", "fallback:"],
  ["unset values", "fallback:"],
] as const) test(`literal indexed -/+ distinguish presence: ${setup}`, async context => {
  const { shell } = fixture(context);
  const result = await shell.exec(`${setup}; set -u; printf '%s:%s' "\${values[1]-fallback}" "\${values[1]+x}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
});

test("scalar index zero and sparse elements use canonical values without mutation", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("value=scalar; values=([5]=five); printf '%s:%s:%s:%s' \"${value[0]-missing}\" \"${value[0]+yes}\" \"${values[5]-missing}\" \"${!values[*]}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "scalar:yes:five:5");
});

test("indexed operands remain lazy and preserve substitution status", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("values=(left right); printf '%s:%s:' \"${values[1]-$(exit 9)}\" \"${values[2]+$(exit 9)}\"; result=${values[2]-$(printf selected; exit 7)}; status=$?; printf '%s:%s' \"$result\" \"$status\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "right::selected:7");
});

test("indexed operand bytes and existing element bytes retain distinct provenance", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("values=($'\\xff'); present=$'\\xfe'; absent=$'\\xfd'; printf '%s%s%s' \"${values[0]-x}\" \"${values[0]+$present}\" \"${values[1]-$absent}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual([...result.stdoutBytes], [255, 254, 253]);
});

test("unquoted indexed alternatives use existing splitting while quotes retain one field", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("values=(set); text='a b'; printf '<%s>' ${values[0]+$text}; printf '|<%s>' \"${values[0]+$text}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "<a><b>|<a b>");
});

test("quotes inside a selected indexed operand retain their field boundary", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("values=(set); text='a b'; printf '<%s>' ${values[1]-\"$text\"}");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "<a b>");
});

test("nested indexed alternatives retain their selectors and lazy branches", async context => {
  const { shell } = fixture(context);
  const result = await shell.exec("values=([5]=five); printf '%s:%s' \"${values[1]-${values[5]-missing}}\" \"${values[5]+${values[1]-selected}}\"");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "five:selected");
});

test("indexed operator parser retains selector and nested substitution form", () => {
  const script = parseShell('printf "${values[1]-$(:)}"', 0, arraysExtension().syntax);
  const command = script.lists[0]!.pipelines[0]!.commands[0]!;
  assert.equal(command.kind, "simple");
  if (command.kind !== "simple") return;
  const part = command.words[1]!.parts.find(part => part.kind === "variable")!;
  const selector = getArraySelector(part);
  assert.equal(selector?.kind, "element");
  if (selector?.kind !== "element") throw new Error("Expected element selector");
  assert.equal(selector.index.decimal, "1");
  assert.equal(selector.index.source, "1");
  assert.equal(selector.index.word?.plain, "1");
  assert.equal(part.operator, "-");
  const substitution = part.alternate!.parts.find(part => part.kind === "substitution")!;
  assert.equal(substitution.form, "dollar-parenthesis");
});

for (const syntax of [undefined, { arrayKeys: true }, { indexedDeclarations: ["readonly"] }] as const) {
  test(`indexed operators are not implicitly enabled: ${JSON.stringify(syntax)}`, () => {
    assert.throws(() => parseShell('printf "${values[1]-fallback}"', 0, syntax), error => error instanceof ShellSyntaxError && error.reason === "Unsupported indexed-array operator");
  });
}

test("indexed operators preserve named subscript syntax", () => {
  const script = parseShell("printf ${values[index]-x}", 0, arraysExtension().syntax);
  const command = script.lists[0]!.pipelines[0]!.commands[0]!;
  assert.equal(command.kind, "simple");
  if (command.kind !== "simple") throw new Error("Expected simple command");
  const part = command.words[1]!.parts.find(part => part.kind === "variable")!;
  const selector = getArraySelector(part);
  assert.equal(selector?.kind, "element");
  if (selector?.kind !== "element") throw new Error("Expected element selector");
  assert.equal(selector.index.source, "index");
  assert.equal(part.operator, "-");
});

for (const expression of ["${values[1]:-x}", "${values[1]:+x}", "${values[1]=x}", "${values[1]?x}", "${values[1]#x}", "${values[1]:1}", "${values[@]-x}", "${!values[@]+x}", "${#values[1]-x}"]) {
  test(`broader indexed forms remain outside the increment: ${expression}`, () => {
    assert.throws(() => parseShell(`printf '${expression}' ${expression}`, 0, arraysExtension().syntax), ShellSyntaxError);
  });
}

for (const value of [false, undefined, 1, "true"]) test(`indexed operator capability rejects invalid own value ${String(value)}`, () => {
  assert.throws(() => captureShellSyntax({ indexedElementOperators: value } as unknown as ShellSyntaxDeclarations), TypeError);
});

test("indexed operator capability never invokes a declaration accessor", () => {
  let reads = 0;
  assert.throws(() => captureShellSyntax({ get indexedElementOperators() { reads++; return true; } } as unknown as ShellSyntaxDeclarations), TypeError);
  assert.equal(reads, 0);
});

test("indexed operator syntax is captured before factory mutation and follows eval", async context => {
  const definition = arraysExtension();
  const syntax = { ...definition.syntax };
  const { shell } = fixture(context, [{ ...definition, syntax, create() {
    Object.defineProperty(syntax, "indexedElementOperators", { value: false });
    return { builtins: [] };
  } }]);
  const result = await shell.exec("values=(left right); eval 'printf \"%s\" \"${values[1]-missing}\"'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "right");
});

test("selected indexed operands enforce the existing expansion budget", async context => {
  const { shell, commands } = fixture(context);
  let runs = 0;
  commands.register({ name: "large", async execute(command) {
    runs++;
    await command.stdout.write(Buffer.alloc(65537, 120));
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec('printf "%s" "${values[1]-$(large)}"', { limits: { maxExpansionBytes: 65536 } }), error => error instanceof ShellLimitError && error.limit === "maxExpansionBytes");
  assert.equal(runs, 1);
  const result = await shell.exec('printf "%s" "${values[1]+$(large)}"', { limits: { maxExpansionBytes: 65536 } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(runs, 1);
});

for (const reason of [undefined, null, false, 0, ""]) test(`selected indexed substitution preserves falsey checkpoint failure ${String(reason)}`, async context => {
  const { shell } = fixture(context, [arraysExtension(), { name: "indexed-operand-failure", create: () => ({ builtins: [], checkpoint(point) {
    if (point === "source-input-read") throw reason;
  } }) }]);
  await assert.rejects(shell.exec('printf "%s" "${values[1]-$(:)}"'), error => Object.is(error, reason));
});
