import assert from "node:assert/strict";
import { CommandRegistry, FsError, pipeBytes, writeBytes } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { quote } from "./invocation-closure-native.js";

const fs = new MemoryFileSystem();
const commands = new CommandRegistry(createStandardCommands());
const shell = new Shell({ fs, commands });
let checks = 0;
async function limited(source: string, options: Parameters<Shell["exec"]>[1], name: string) {
  await assert.rejects(shell.exec(source, options), error => error instanceof ShellLimitError && error.limit === name);
  checks++;
}
let calls = 0;
commands.register({ name: "tick", execute() { calls++; return { exitCode: 0 }; } });
await limited('V=abc; : "${V:$(tick; tick; tick; tick):1}"', { limits: { maxCommands: 4 } }, "maxCommands");
assert.ok(calls > 0 && calls < 4);
await limited('V=abc; : "${V:$(while true; do tick; done):1}"', { limits: { maxLoopIterations: 2 } }, "maxLoopIterations");
await limited('V=abc; : "${V:$(printf 1):1}"', { limits: { maxSubstitutionDepth: 0 } }, "maxSubstitutionDepth");
await limited('V=abc; : "${V:$(printf 111):1}"', { limits: { maxOutputBytes: 2 } }, "maxOutputBytes");
await limited(': "${V:0:1}"', { env: { V: "x".repeat(32) }, limits: { maxExpansionBytes: 8 } }, "maxExpansionBytes");
await limited(': "${V:N:1}"', { env: { V: "abc", N: "1+".repeat(12) + "0" }, limits: { maxExpansionBytes: 8 } }, "maxExpansionBytes");
let digits = 0;
commands.register({ name: "num", async execute(context) { digits++; await writeBytes(context.stdout, Buffer.from("1".repeat(24)), context.signal); return { exitCode: 0 }; } });
await limited(': "${V:$(num):1}"', { env: { V: "abc" }, limits: { maxExpansionBytes: 8 } }, "maxExpansionBytes");
assert.equal(digits, 1);
const code = 'V="é🙂Z"; : "${V:1:1}"';
const evaluated = `eval ${quote(code)}`;
const sourceBytes = Buffer.byteLength(evaluated) + Buffer.byteLength(code);
assert.equal((await shell.exec(evaluated, { env: { LC_ALL: "en_US.UTF-8" }, limits: { maxSourceBytes: sourceBytes } })).exitCode, 0);
await limited(evaluated, { limits: { maxSourceBytes: sourceBytes - 1 } }, "maxSourceBytes");
let origin: boolean | undefined;
commands.register({ name: "pass", async execute(context) { origin = context.stdinIsDefault; await pipeBytes(context.stdin, context.stdout, context.signal); return { exitCode: 0 }; } });
const bytes = Uint8Array.of(49, 0, 255, 239, 187, 191, 10);
const streamed = await shell.exec('V=abcd; : "${V:$(IFS= read -r -N 1 offset; printf "%s" "$offset"):1}"; pass', { stdin: bytes });
assert.equal(streamed.exitCode, 0); assert.equal(streamed.stderr, "");
assert.deepEqual(streamed.stdoutBytes, bytes.slice(1)); assert.equal(origin, false); checks++;
const controller = new AbortController();
const reason = new FsError("ENOENT", { path: "substring-cancel" });
let waits = 0;
commands.register({ name: "waiter", execute() { waits++; setTimeout(() => controller.abort(reason), 5); return new Promise((_, reject) => setTimeout(() => reject(new Error("late substring rejection")), 20)); } });
await assert.rejects(shell.exec('V=abc; : "${V:$(waiter):1}"', { signal: controller.signal }), error => error === reason);
await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(waits, 1); checks++;
await fs.writeFile("/lib", Buffer.from('INDEX=1; RESULT=${VALUE:INDEX++:2}; export RESULT'));
let exported: string | undefined;
commands.register({ name: "observe", execute(context) { exported = context.env.RESULT; return { exitCode: 0 }; } });
const sourced = await shell.exec('VALUE=abcdef; . /lib; observe; printf "%s:%s" "$INDEX" "$RESULT"');
assert.equal(exported, "bc"); assert.equal(sourced.stdout, "2:bc"); checks++;
for (const source of ['V=abc; printf before >marker; : "${V:$(true |):1}"', 'V=abc; printf before >marker; : "${V:1:2"']) {
  const result = await shell.exec(source); assert.notEqual(result.exitCode, 0); assert.equal(result.stdout, "");
  await assert.rejects(fs.stat("/marker"), error => error instanceof FsError && error.code === "ENOENT"); checks++;
}
for (const parameter of ["@", "*"]) {
  const result = await shell.exec(`printf before >marker; : "\${${parameter}:1:2}"`);
  assert.equal(result.exitCode, 2); assert.match(result.stderr, /Unsupported non-scalar substring expansion/u);
  await assert.rejects(fs.stat("/marker"), error => error instanceof FsError && error.code === "ENOENT"); checks++;
}
const readonly = await shell.exec('V=abcdef; readonly INDEX=1; : "${V:INDEX++:2}"; printf wrong');
assert.notEqual(readonly.exitCode, 0); assert.equal(readonly.stdout, ""); assert.match(readonly.stderr, /readonly variable/u); checks++;
console.log(JSON.stringify({ checks }));
