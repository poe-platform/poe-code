import assert from "node:assert/strict";
import { CommandRegistry, FsError, pipeBytes, writeBytes } from "../../src/contracts/index.js";
import { createStandardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";

const fs = new MemoryFileSystem();
const commands = new CommandRegistry(createStandardCommands());
const shell = new Shell({ fs, commands });
const source = "value=$(:\n\nprintf '%s' \"$(printf 'a\\0b')\"\n); printf '%s' \"$value\"";
for (const [limit, maximum] of [["maxCommands", 2], ["maxOutputBytes", 2], ["maxSubstitutionDepth", 1], ["maxSourceBytes", Buffer.byteLength(source) - 1]] as const) {
  await assert.rejects(shell.exec(source, { limits: { [limit]: maximum } }), error => error instanceof ShellLimitError && error.limit === limit);
}
const successful = await shell.exec(source);
assert.equal(successful.stdout, "ab");
assert.equal(successful.stderr, "shell: line 5: warning: command substitution: ignored null byte in input\n");
let origin: boolean | undefined;
commands.register({ name: "transfer", async execute(context) { origin = context.stdinIsDefault; await pipeBytes(context.stdin, context.stdout, context.signal); return { exitCode: 0 }; } });
const streamed = await shell.exec('value=$(:\n\ntransfer); printf "%s" "$value"', { stdin: Uint8Array.of(65, 0, 66) });
assert.equal(streamed.stdout, "AB");
assert.equal(origin, false);
let emitted = 0;
commands.register({ name: "emit", async execute(context) { emitted++; await writeBytes(context.stdout, Uint8Array.of(65, 0, 66), context.signal); return { exitCode: 0 }; } });
commands.register({ name: "callback", async execute(context) { assert.ok(context.invoke); return context.invoke("bash", ["-c", "value=$(emit); printf '%s' \"$value\"", "callback-source"]); } });
const callback = await shell.exec("callback");
assert.equal(callback.stdout, "AB");
assert.equal(callback.stderr, "callback-source: line 1: warning: command substitution: ignored null byte in input\n");
assert.equal(emitted, 1);
const controller = new AbortController();
const reason = new FsError("EACCES", { path: "diagnostic-cancel" });
let warnings = 0;
await assert.rejects(shell.exec("value=$(emit)", { signal: controller.signal, stderr: { write() {
  warnings++;
  setTimeout(() => controller.abort(reason), 5);
  return new Promise((_, reject) => setTimeout(() => reject(new Error("late warning rejection")), 20));
} } }), error => error === reason);
await new Promise(resolve => setTimeout(resolve, 35));
assert.equal(warnings, 1);
assert.equal(emitted, 2);
assert.equal((await shell.exec('keep=parent; value=$(keep=child; emit); printf "%s:%s" "$keep" "$value"')).stdout, "parent:AB");
console.log(JSON.stringify({ checks: 9 }));
