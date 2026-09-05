import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { FsError } from "../../../../src/contracts/errors.js";
import { shellValueBytes, shellValueFromBytes, type ShellValue } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { mapfileExtension } from "../../../../src/shell/extensions/mapfile/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import { primaryReference } from "./primary-reference.js";

const numericCases = ["n", "O", "s", "u", "c"].flatMap(flag => ["\\r", "\\n", "\\v", "\\f"].map(space => ({
  name: `numeric -${flag} trailing ${space}`,
  script: `a=(old keep); mapfile -${flag} $'${flag === "u" ? "0" : "1"}${space}' a; printf 'status=%s:' "$?"; printf '<%s>' "\${a[@]}"; read -r tail; printf 'tail=<%s>' "$tail"`,
  input: "first\nsecond\nthird\n",
})));

const leadingControls = ["n", "O", "s", "u", "c"].map(flag => ({
  name: `numeric -${flag} leading C whitespace and trailing tab remain accepted`,
  script: `a=(old keep); mapfile -${flag} $'\\r\\n\\v\\f +${flag === "u" ? "0" : "1"}\\t' a; printf 'status=%s:' "$?"; printf '<%s>' "\${a[@]}"`,
  input: "first\nsecond\n",
}));

const nativeCases = [
  ...numericCases,
  ...leadingControls,
  ...[2147483647, 2147483648, 4294967294].map(origin => ({
    name: `callback index uses native signed presentation at origin ${origin}`,
    script: `cb() { printf 'cb=%s:<%s>;' "$1" "$2"; }; mapfile -tn1 -O${origin} -c1 -C cb a; printf '<%s>' "\${a[${origin}]}"`,
    input: "one\ntwo\n",
  })),
  { name: "moved input validates only its new descriptor", script: `mapfile -tn1 -u4 a 3<&0 4<&3-; printf 'status=%s:' "$?"; printf '<%s>' "\${a[@]}"; read -r tail; printf '<%s>' "$tail"`, input: "one\ntwo\n" },
  { name: "closed moved source cannot be rescued by later valid descriptor", script: `a=(old); mapfile -u3 -u4 a 3<&0 4<&3-; printf 'status=%s:<%s>' "$?" "\${a[@]}"`, input: "one\n" },
  { name: "invalid intermediate descriptor precedes readonly binding", script: `a=(old); readonly a; mapfile -u0 -u9 -u0 a; printf 'status=%s:<%s>' "$?" "\${a[@]}"`, input: "one\n" },
  { name: "readarray preserves invalid raw option byte", script: `readarray $'-\\xff'; printf 'status=%s' "$?"`, input: "one\n" },
  { name: "readarray preserves invalid raw numeric byte", script: `readarray -n $'\\xff'; printf 'status=%s' "$?"`, input: "one\n" },
  { name: "origin wrap cells and callback index without array-key expansion", script: `cb() { printf 'cb=%s:<%s>;' "$1" "$2"; }; mapfile -t -O4294967295 -n2 -c1 -C cb a; printf '<%s><%s>' "\${a[4294967295]}" "\${a[0]}"`, input: "one\ntwo\nthree\n" },
  { name: "skip and callback quantum count copied rather than discarded records", script: `cb() { printf 'cb=%s:<%s>;' "$1" "$2"; }; mapfile -t -s2 -n3 -c2 -C cb a; printf '<%s>' "\${a[@]}"; read -r tail; printf 'tail=<%s>' "$tail"`, input: "skip1\nskip2\na\nb\nc\ntail\n" },
  { name: "NUL truncation does not trim a delimiter after the truncated payload", script: `mapfile -td: a; printf '<%s>' "\${a[@]}"`, input: "a\0hidden:b:\0tail:" },
  { name: "NUL delimiter with trimming and skip retains next input record", script: `mapfile -td '' -s1 -n1 a; printf '<%s>' "\${a[@]}"; mapfile -d '' b; printf '<%s>' "\${b[@]}"`, input: "skip\0one\0tail\0" },
  { name: "callback quoted payload cannot execute shell syntax", script: `cb() { printf 'cb:<%s>;' "$2"; }; mapfile -t -c1 -C cb a; printf '<%s>' "\${a[@]}"`, input: "'$(printf injected)`printf bad`\\\n" },
  { name: "callback argument prefix receives appended index and line", script: `cb() { printf '<%s><%s><%s>;' "$1" "$2" "$3"; }; mapfile -tn1 -c1 -C 'cb prefix' a; printf '<%s>' "\${a[@]}"`, input: "one\ntwo\n" },
];

for (const entry of nativeCases) test(`mapfile independent native: ${entry.name}`, {}, async context => {
  const native = primaryReference(import.meta.url, entry.script, entry.input);
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, extensions: [mapfileExtension()] });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(entry.script, { stdin: Buffer.from(entry.input) });
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(args: readonly ShellValue[]) {
  const controller = new AbortController();
  const events: string[] = [];
  const diagnostics: ShellValue[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];
  const cells = new Map<number, ShellValue>([[0, "old"]]);
  let writerClosed = false, inputClosed = false, recordReleased = false, reads = 0;
  const writer = {
    async set(index: number, value: ShellValue) { assert.equal(writerClosed, false); events.push("set"); cells.set(index, value); },
    async close() { if (!writerClosed) { writerClosed = true; events.push("writer close"); } },
  };
  const input = {
    read: async (): Promise<never> => { throw new Error("unexpected cooked read"); },
    readiness: (): never => { throw new Error("unexpected poll"); },
    async record() {
      assert.equal(inputClosed, false);
      reads++;
      return { shellValue: shellValueFromBytes(Uint8Array.of(255, 39, 0, 65, 10)), reason: "delimiter" as const,
        async release() { if (!recordReleased) { recordReleased = true; events.push("record release"); } },
      };
    },
    async release() { if (!inputClosed) { inputClosed = true; events.push("input release"); } },
  };
  const context: ShellExtensionContext = {
    command: "mapfile", args: [], argumentValues: args, status: 0, functionDepth: 0, sourceDepth: 0,
    stdin: { [Symbol.asyncIterator]() { return { async next(): Promise<IteratorResult<Uint8Array>> { throw new Error("unexpected direct input read"); } }; } },
    stdout: { async write() {} }, stderr: { async write() {} }, signal: controller.signal, scope: {},
    bindings: {
      describe() { events.push("describe"); return { kind: "indexed", readonly: false, exported: false }; },
      get: (name, index = 0) => cells.get(index),
      async assign() { throw new Error("unexpected scalar assignment"); },
      async prepare() { throw new Error("unexpected transaction"); },
      async openIndexed(name, options) { events.push("writer"); if (options?.clear) cells.clear(); return writer; },
    },
    input: {
      observe() { throw new Error("Mapfile must not acquire a descriptor observer"); },
      validateOpen(descriptor) { assert.equal(cleanups.length, 1); events.push(`validate:${descriptor}`); if (descriptor === 9) throw new FsError("EBADF"); },
      borrow(descriptor) { events.push(`borrow:${descriptor}`); if (descriptor === 3) throw new FsError("EBADF"); return input; },
    },
    async evaluate() { events.push("callback"); return 0; },
    variable: () => undefined, accountSource() {},
    async diagnostic(value) { diagnostics.push(value); },
    registerCleanup(cleanup) { cleanups.push(cleanup); },
  };
  return { context, controller, events, diagnostics, cleanups, cells, writer, input,
    reads: () => reads,
    execute: () => Promise.resolve(mapfileExtension().create().builtins[0]!.execute(context)),
  };
}

for (const entry of [
  { args: ["-u3", "-u0", "-u9", "-u0", "-n1"], status: 1, events: ["validate:3", "validate:0", "validate:9"], size: 1 },
  { args: ["-u3", "-u0", "-u3", "-n1"], status: 0, events: ["validate:3", "validate:0", "validate:3", "describe", "writer", "borrow:3", "writer close"], size: 0 },
  { args: ["-u3", "-u0", "-Q"], status: 2, events: ["validate:3", "validate:0"], size: 1 },
]) test(`mapfile independent admission ordering: ${entry.args.join(" ")}`, async () => {
  const subject = fixture(entry.args);
  assert.equal(await subject.execute(), entry.status);
  assert.deepEqual(subject.events, entry.events);
  assert.equal(subject.cells.size, entry.size);
  assert.equal(subject.reads(), 0);
  await subject.cleanups[0]!();
  assert.deepEqual(subject.events, entry.events);
});

for (const reason of [undefined, false, null, -0, NaN]) test(`mapfile independent callback rejection preserves exact primary ${String(reason)} negative-zero=${Object.is(reason, -0)}`, async () => {
  const subject = fixture(["-n1", "-C", "callback", "-c1"]);
  subject.context.evaluate = async source => {
    assert.deepEqual(Buffer.from(shellValueBytes(source)), Buffer.concat([Buffer.from("callback 0 "), Buffer.from([39, 255, 39, 92, 39, 39, 39])]));
    subject.events.push("callback");
    throw reason;
  };
  subject.writer.close = async () => { subject.events.push("writer close"); throw new Error("secondary cleanup"); };
  await assert.rejects(subject.execute(), error => Object.is(error, reason));
  assert.equal(subject.cells.size, 0);
  assert.equal(subject.reads(), 1);
  assert.equal(subject.events.includes("record release"), true);
  assert.equal(subject.events.includes("input release"), true);
});

test("mapfile independent close drains an admitted callback and never publishes its pending record", async () => {
  const subject = fixture(["-n1", "-C", "callback", "-c1"]);
  const entered = deferred<void>(), gate = deferred<number>();
  subject.context.evaluate = async () => { entered.resolve(); return gate.promise; };
  const pending = subject.execute();
  const rejected = assert.rejects(pending, /Mapfile invocation is closed/u);
  await entered.promise;
  let settled = false;
  const closing = Promise.resolve(subject.cleanups[0]!()).then(() => { settled = true; });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(subject.cells.size, 0);
    assert.equal(subject.events.includes("input release"), true);
  } finally { gate.resolve(127); await Promise.all([rejected, closing]); }
  assert.equal(subject.events.includes("set"), false);
  assert.equal(subject.events.includes("record release"), true);
});

for (const reason of [false, null, 0, ""]) test(`mapfile independent root cancellation during descriptor validation keeps exact ${JSON.stringify(reason)}`, async () => {
  const subject = fixture(["-u0", "-n1"]);
  subject.context.input.validateOpen = () => { subject.controller.abort(reason); throw new FsError("EBADF"); };
  await assert.rejects(subject.execute(), error => Object.is(error, reason));
  assert.deepEqual(subject.events, []);
  assert.deepEqual(subject.diagnostics, []);
  assert.equal(subject.cells.get(0), "old");
  await subject.cleanups[0]!();
});

function quoteCallback(source: string): string {
  return `'${source.split("'").join("'\\''")}'`;
}

const innerClipped = "mapfile -tn1 -O2147483648 -c1 -C : b; :";
const innerSyntax = 'mapfile -tn1 -c1 -C ")" b; :';
const nestedClipped = `mapfile -tn1 -c1 -C ${quoteCallback(innerClipped)} c; :`;
const contextCases = [
  { name: "ordinary inline callback syntax error", script: "mapfile -tn1 -c1 -C ')' a; printf 'status=%s' \"$?\"" },
  { name: "nested inline callback syntax error", script: `mapfile -tn1 -c1 -C ${quoteCallback(innerSyntax)} a; printf 'status=%s' "$?"` },
  { name: "nested inline callback clipping", script: `mapfile -tn1 -c1 -C ${quoteCallback(innerClipped)} a; printf 'status=%s' "$?"` },
  { name: "two nested inline callback evaluations", script: `mapfile -tn1 -c1 -C ${quoteCallback(nestedClipped)} a; printf 'status=%s' "$?"` },
  { name: "function callback invokes clipped inner callback", script: `outer() { ${innerClipped}; }; mapfile -tn1 -c1 -C outer a; printf 'status=%s' "$?"` },
  { name: "callback defines and invokes function with runtime error", script: `mapfile -tn1 -c1 -C ${quoteCallback("inner() { missing_callback_command; }; inner; :")} a; printf 'status=%s' "$?"` },
  { name: "previously defined function with runtime error", script: "cb() { missing_callback_command; }; mapfile -tn1 -c1 -C cb a; printf 'status=%s' \"$?\"" },
  { name: "multiline callback syntax error", script: `mapfile -tn1 -c1 -C ${quoteCallback(":\n)")} a; printf 'status=%s' "$?"` },
];

for (const entry of contextCases) test(`mapfile callback diagnostic context: ${entry.name}`, {}, async context => {
  const script = `${entry.script}; printf 'a=<%s>;b=<%s>;c=<%s>' "\${a[*]}" "\${b[*]}" "\${c[*]}"`;
  const native = primaryReference(import.meta.url, script, "one\ntwo\nthree\nfour\n");
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [mapfileExtension()] });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(script, { stdin: "one\ntwo\nthree\nfour\n" });
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});

for (const [name, body] of [
  ["runtime error", "missing_callback_command;"],
  ["nested clipped callback", innerClipped],
] as const) test(`mapfile callback function retains named source origin: ${name}`, {}, async context => {
  const definition = `callback() {\n${body}\n}\n`;
  const script = `. /dev/fd/3 3<<'MAPFILE_REVIEW_END'\n${definition}MAPFILE_REVIEW_END\nmapfile -tn1 -c1 -C callback a; printf 'status=%s;a=<%s>;b=<%s>' "$?" "\${a[*]}" "\${b[*]}"`;
  const native = primaryReference(import.meta.url, script, "one\ntwo\nthree\n");
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev/fd", { recursive: true });
  await fs.writeFile("/dev/fd/3", Buffer.from(definition));
  const shell = new Shell({ fs, extensions: [mapfileExtension()] });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(script, { stdin: "one\ntwo\nthree\n" });
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});

for (const entry of [
  { origin: 0, callback: ": 0 'é'\\''😀'" },
  { origin: 2147483648, callback: ": -2147483648 'é'\\''😀" },
]) for (const delta of [0, -1]) test(`mapfile callback source budget charges exact emitted bytes: origin=${entry.origin} delta=${delta}`, async context => {
  const script = `mapfile -tn1 -O${entry.origin} -c1 -C : a`;
  const extension = mapfileExtension(), create = extension.create;
  const sources: Uint8Array[] = [];
  let publications = 0;
  extension.create = () => {
    const instance = create();
    const builtin = instance.builtins[0]!, execute = builtin.execute;
    builtin.execute = command => execute({ ...command,
      async evaluate(source, options) { sources.push(shellValueBytes(source)); return command.evaluate(source, options); },
      bindings: { ...command.bindings, async openIndexed(name, options) {
        const writer = await command.bindings.openIndexed(name, options);
        return { async set(index, value) { publications++; await writer.set(index, value); }, close: () => writer.close() };
      } },
    });
    return instance;
  };
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension], limits: {
    maxSourceBytes: Buffer.byteLength(script) + Buffer.byteLength(entry.callback) + delta,
  } });
  context.after(() => shell.dispose());
  const execution = shell.exec(script, { stdin: "é'😀\n" });
  if (delta === 0) { assert.equal((await execution).exitCode, 0); assert.equal(publications, 1); }
  else { await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxSourceBytes"); assert.equal(publications, 0); }
  assert.deepEqual(sources.map(bytes => Buffer.from(bytes)), [Buffer.from(entry.callback)]);
});

for (const origin of [0, 2147483648]) test(`mapfile callback diagnostic output budget aborts before publication at origin ${origin}`, async context => {
  const extension = mapfileExtension(), create = extension.create;
  let publications = 0, writes = 0;
  extension.create = () => {
    const instance = create();
    const builtin = instance.builtins[0]!, execute = builtin.execute;
    builtin.execute = command => execute({ ...command, bindings: { ...command.bindings, async openIndexed(name, options) {
      const writer = await command.bindings.openIndexed(name, options);
      return { async set(index, value) { publications++; await writer.set(index, value); }, close: () => writer.close() };
    } } });
    return instance;
  };
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension], limits: { maxOutputBytes: 1 } });
  context.after(() => shell.dispose());
  const script = `mapfile -tn1 -O${origin} -c1 -C ${origin ? ":" : "')'"} a`;
  await assert.rejects(shell.exec(script, { stdin: "x\n", stderr: { async write() { writes++; } } }),
    error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  assert.equal(publications, 0);
  assert.equal(writes, 0);
});

test("mapfile diagnostic control: direct function without mapfile retains native source name", {}, async context => {
  const script = "cb() { missing_callback_command; }; cb; printf 'status=%s' \"$?\"";
  const native = primaryReference(import.meta.url, script);
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [mapfileExtension()] });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(script);
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});

for (const invoke of ["callback", "eval callback"]) test(`mapfile diagnostic control: named function via ${invoke}`, {}, async context => {
  const definition = "callback() {\nmissing_callback_command;\n}\n";
  const script = `. /dev/fd/3 3<<'MAPFILE_REVIEW_END'\n${definition}MAPFILE_REVIEW_END\n${invoke}; printf 'status=%s' "$?"`;
  const native = primaryReference(import.meta.url, script);
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev/fd", { recursive: true });
  await fs.writeFile("/dev/fd/3", Buffer.from(definition));
  const shell = new Shell({ fs, extensions: [mapfileExtension()] });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const actual = await shell.exec(script);
  assert.equal(actual.exitCode, native.status);
  assert.deepEqual(Buffer.from(actual.stdoutBytes), native.stdout);
  assert.deepEqual(Buffer.from(actual.stderrBytes), native.stderr);
});
