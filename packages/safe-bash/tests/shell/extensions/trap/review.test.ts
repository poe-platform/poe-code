import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { trapExtension, type TrapSignalHost } from "../../../../src/shell/extensions/trap/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { nativeOptions, runNative } from "./oracle.js";

const nativeCases: readonly [string, string, string?][] = [
  ["raw action byte ff", String.raw`action=$'printf "\377"'; trap "$action" EXIT`],
  ["raw action distinguishes ff and fe", String.raw`first=$'printf "\377"'; second=$'printf "\376"'; trap "$first" USR1; trap "$second" EXIT; trap -p USR1; trap - USR1`],
  ["raw variables and positional arguments survive deferred expansion", String.raw`set -- $'\377' $'\376'; value=$'\375'; trap 'printf "%s" "$value" "$@"' EXIT`],
  ["DEBUG line numbers and unexpanded command spelling", `trap 'printf "[%s:%s]\\n" "$LINENO" "$BASH_COMMAND"' DEBUG\nvalue=one\nprintf '%s\\n' "$value"\ntrap - DEBUG`],
  ["DEBUG canonical descriptor spelling", `trap 'printf "[%s]" "$BASH_COMMAND"' DEBUG; printf hi >&2; trap - DEBUG`],
  ["DEBUG for-loop safe points", `trap 'printf "[%s]" "$BASH_COMMAND"' DEBUG; for value in a b; do :; done; trap - DEBUG`],
  ["DEBUG case-command safe point", `trap 'printf "[%s]" "$BASH_COMMAND"' DEBUG; case value in value) :;; esac; trap - DEBUG`],
  ["function-local DEBUG restores the caller action", `trap 'printf outer;' DEBUG; f() { trap 'printf inner;' DEBUG; :; }; f; :; trap - DEBUG`],
  ["nested function and source RETURN scopes", `trap 'printf "return:%s;" "$?"' RETURN; set -T; f() { local value=local; . /dev/stdin; printf "f:%s;" "$value"; }; f; printf end`, "value=source; return 3"],
  ["EXIT evaluation syntax failure", `trap 'if' EXIT; printf body; exit 7`],
  ["EXIT evaluation nounset failure", `trap 'set -u; printf "%s" "$absent"' EXIT; exit 7`],
  ["subshell own EXIT cannot replace parent action", `trap 'printf parent;' EXIT; (trap 'printf child;' EXIT; exit 4); printf 'status:%s;' "$?"; trap -p EXIT`],
  ["ERR pipeline exposes the final pipeline command", `set -o pipefail; trap 'printf "[%s:%s]" "$?" "$BASH_COMMAND"' ERR; false | true; :`],
  ["DEBUG preserves arithmetic and conditional command delimiters", `trap 'printf "[%s]" "$BASH_COMMAND"' DEBUG; (( value=1+2 )); [[ a = b ]]; trap - DEBUG`],
];

for (const [name, source, input] of nativeCases) {
  test(`independent native trap review: ${name}`, { ...nativeOptions(), timeout: 2500 }, async context => {
    const expected = runNative(source, input);
    const oracle = expected.executable;
    assert.equal(expected.error, undefined);
    assert.equal(expected.signal, null);
    if (!name.startsWith("EXIT evaluation")) assert.equal(expected.status, 0, expected.stderr.toString());
    const fs = new MemoryFileSystem();
    if (input !== undefined) {
      await fs.mkdir("/dev");
      await fs.writeFile("/dev/stdin", Buffer.from(input));
    }
    const shell = new Shell({ fs, extensions: [trapExtension()], limits: { maxWallClockMs: 1500 } });
    context.after(() => shell.dispose());
    for (const command of basicCommands()) shell.register(command);
    const actual = await shell.exec(source, input === undefined ? {} : { stdin: input });
    assert.deepEqual(Buffer.from(actual.stdoutBytes), expected.stdout, `${oracle}: stdout`);
    assert.equal(actual.exitCode, expected.status, `${oracle}: exit status; ${actual.stderr}`);
    assert.deepEqual(Buffer.from(actual.stderrBytes), expected.stderr, `${oracle}: stderr`);
  });
}

test("independent duplicate extension registrations reject before startup side effects", async context => {
  for (const duplicateName of [false, true]) {
    let started = 0;
    const extensions: ShellExtension[] = ["first", duplicateName ? "first" : "second"].map(name => ({
      name, create: () => ({ builtins: [{ name: "probe", execute: () => 0 }], start() { started++; } }),
    }));
    const shell = new Shell({ fs: new MemoryFileSystem(), extensions });
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec(":"), TypeError);
    assert.equal(started, 0);
  }
});

test("independent extension startup cannot hide the original EXIT event failure behind cleanup", async context => {
  const primary = new Error("original EXIT event failure");
  const secondary = new Error("later extension cleanup failure");
  let cleanups = 0;
  const extension: ShellExtension = { name: "failure-review", create: () => ({
    builtins: [],
    start(context) { context.registerCleanup(() => { cleanups++; throw secondary; }); },
    event(event) { if (event === "exit") throw primary; },
  }) };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [extension] });
  context.after(() => shell.dispose());
  const containsPrimary = (error: unknown): boolean => error === primary
    || error instanceof AggregateError && error.errors.some(containsPrimary);
  await assert.rejects(shell.exec(":"), containsPrimary);
  assert.equal(cleanups, 1);
});

test("independent EXIT completion waits for host teardown and closes delivery admission first", { timeout: 2000 }, async context => {
  let deliver!: (signal: string | number) => boolean;
  let closing!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { closing = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let cleanups = 0;
  const host: TrapSignalHost = { subscribe(receiver) {
    deliver = receiver;
    return async () => { cleanups++; closing(); await gate; };
  } };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [trapExtension({ signalHost: host })] });
  context.after(() => { release(); return shell.dispose(); });
  for (const command of basicCommands()) shell.register(command);
  let settled = false;
  const operation = shell.exec(`trap ':' USR1; trap 'printf handled' EXIT; exit 7`).then(result => { settled = true; return result; });
  try {
    await entered;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(deliver("USR1"), false);
    release();
    const result = await operation;
    assert.equal(result.stdout, "handled");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 7);
    assert.equal(cleanups, 1);
    await shell.dispose();
    assert.equal(cleanups, 1);
  } finally { release(); }
});

test("independent active disposal suppresses EXIT and awaits registered extension cleanup", { timeout: 2000 }, async context => {
  let entered!: () => void, closing!: () => void, release!: () => void;
  const active = new Promise<void>(resolve => { entered = resolve; });
  const teardown = new Promise<void>(resolve => { closing = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let cleanups = 0;
  const extension: ShellExtension = { name: "disposal-review", create: () => ({
    builtins: [], start(context) { context.registerCleanup(async () => { cleanups++; closing(); await gate; }); },
  }) };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [trapExtension(), extension] });
  context.after(() => { release(); return shell.dispose(); });
  for (const command of basicCommands()) shell.register(command);
  shell.register({ name: "hold", async execute(command) {
    entered();
    await new Promise<void>(resolve => command.signal.addEventListener("abort", () => resolve(), { once: true }));
    command.signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  const output: Uint8Array[] = [];
  const operation = shell.exec(`trap 'printf forbidden' EXIT; hold`, { stdout: { async write(bytes) { output.push(new Uint8Array(bytes)); } } });
  const rejected = assert.rejects(operation, error => error instanceof Error && error.message === "Shell is disposed");
  await active;
  let disposed = false;
  const disposal = shell.dispose().then(() => { disposed = true; });
  try {
    await teardown;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(disposed, false);
    assert.equal(Buffer.concat(output).length, 0);
    release();
    await rejected;
    await disposal;
    assert.equal(cleanups, 1);
  } finally { release(); }
});
