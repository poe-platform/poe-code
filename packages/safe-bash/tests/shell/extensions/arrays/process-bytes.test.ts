import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createCommandArguments, getCommandArguments } from "../../../../src/contracts/command.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { nativeOptions, runNative } from "../trap/oracle.js";

const prefix = String.raw`a=($'\xff' '�' $'\xfe' ''); `;
const expected = "3cff3e3cefbfbd3e3cfe3e3c3e";
const cases: readonly [string, string, string?][] = [
  ["bash command string", `bash -c 'printf "<%s>" "$@"' child "\${a[@]}"`],
  ["sh command string", `sh -c 'printf "<%s>" "$@"' child "\${a[@]}"`],
  ["option terminator and display-identical arg0", `bash -c -- 'printf "<%s>" "$@"' '�' "\${a[@]}"`],
  ["bash script", `bash /child.sh "\${a[@]}"`],
  ["sh script", `sh -- /child.sh "\${a[@]}"`],
  ["direct script", `/child.sh "\${a[@]}"`],
  ["standard-input script", `bash -s -- "\${a[@]}"`, `printf '<%s>' "$@"`],
  ["function forwarding into child", `forward() { bash /child.sh "$@"; }; forward "\${a[@]}"`],
  ["child array and nested forwarding", `bash -c 'b=("$@"); sh /child.sh "\${b[@]}"' child "\${a[@]}"`],
];

for (const [name, source, stdin] of cases) test(`process positional bytes: ${name}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/child.sh", Buffer.from('#!/bin/bash\nprintf "<%s>" "$@"\n'));
  await fs.chmod!("/child.sh", 0o755);
  const shell = new Shell({ fs });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(prefix + source, { ...(stdin === undefined ? {} : { stdin }), env: { LC_ALL: "C" } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), expected);
});

test("pinned Bash child positional byte witness uses explicit interpreter binding", nativeOptions(), () => {
  const result = runNative(prefix + `"$BASH" -c 'printf "<%s>" "$@"' child "\${a[@]}"`);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(result.stderr.toString(), "");
  assert.equal(result.stdout.toString("hex"), expected);
});

test("child positional replacement cannot mutate parent bytes", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(prefix + `set -- "\${a[@]}"; bash -c 'shift; set -- changed; a=(changed)' child "$@"; printf '<%s>' "$@" "\${a[@]}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), expected + expected);
});

test("literal invoke preserves owned argv identity through process positionals", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  const input = Uint8Array.of(255);
  const value = shellValueFromBytes(input);
  input.fill(65);
  shell.register({ name: "enter", execute(command) {
    const argumentValues = createCommandArguments(["-c", 'inspect "$@"', "�", value, "�"]);
    return command.invoke!("bash", argumentValues.args, { argumentValues });
  } });
  let inspected = false;
  shell.register({ name: "inspect", execute(command) {
    const arguments_ = getCommandArguments(command);
    assert.equal(arguments_.args, command.args);
    assert.deepEqual(arguments_.values.map(item => Buffer.from(shellValueBytes(item)).toString("hex")), ["ff", "efbfbd"]);
    inspected = true;
    return { exitCode: 0 };
  } });
  const result = await shell.exec("enter");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(inspected, true);
});

for (const reason of [false, 0, "", null]) test(`raw child cancellation retains falsey identity: ${String(reason)}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  const controller = new AbortController();
  let cleaned = false;
  shell.register({ name: "cancel", execute(command) {
    assert.equal(Buffer.from(shellValueBytes(getCommandArguments(command).values[0]!)).toString("hex"), "ff");
    command.registerCleanup!(async () => { await Promise.resolve(); cleaned = true; throw new Error("secondary cleanup"); });
    controller.abort(reason);
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec(prefix + `bash -c 'cancel "$@"' child "\${a[@]}"`, { signal: controller.signal }), error => Object.is(error, reason));
  assert.equal(cleaned, true);
});

test("raw child argv respects the shared expansion budget before dispatch", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxExpansionBytes: 128 } });
  context.after(() => shell.dispose());
  let dispatched = false;
  shell.register({ name: "inspect", execute() { dispatched = true; return { exitCode: 0 }; } });
  shell.register({ name: "enter", execute(command) {
    const argumentValues = createCommandArguments(["-c", 'inspect "$@"', "child", shellValueFromBytes(new Uint8Array(256).fill(255))]);
    return command.invoke!("bash", argumentValues.args, { argumentValues });
  } });
  await assert.rejects(shell.exec("enter"), error => error instanceof ShellLimitError || error instanceof Error && error.message.includes("capacity"));
  assert.equal(dispatched, false);
});

const zeroCases = [
  ['printf "<%s>" "$0"', "3cff3e"],
  ['shift; set -- changed; printf "<%s>" "$0" "$@"', "3cff3e3c6368616e6765643e"],
  ['f() { shift; printf "<%s>" "$0"; }; f argument; printf "<%s>" "$0"', "3cff3e3cff3e"],
  ['(printf "<%s>" "$0"); result=$(printf "<%s>" "$0"); printf "%s" "$result"', "3cff3e3cff3e"],
] as const;

for (const [body, output] of zeroCases) test(`raw child zero survives positional scopes: ${body}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem() });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  const result = await shell.exec(`bash -c '${body}' $'\\xff' argument`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), output);
});

test("pinned Bash confirms raw child zero scope expectations", nativeOptions(), () => {
  for (const [body, output] of zeroCases) {
    const result = runNative(`"$BASH" -c '${body}' $'\\xff' argument`);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stderr.toString(), "");
    assert.equal(result.stdout.toString("hex"), output);
  }
});
