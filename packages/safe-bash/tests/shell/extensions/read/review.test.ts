import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { commandRuntimeIdentity } from "../../../../src/contracts/command.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import type { ShellValue } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext, ShellIndexedWriter } from "../../../../src/shell/extensions.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import type { ReadLine } from "../../../../src/shell/input.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError, type ShellLimits } from "../../../../src/shell/types.js";
import { primaryReference } from "./primary-reference.js";

function setup(transform?: (context: ShellExtensionContext) => ShellExtensionContext, limits: ShellLimits = {}) {
  const fs = createMemoryFileSystem(), definition = readExtension();
  const shell = new Shell({ fs, limits, extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin,
      name: "read_review", execute: (context: ShellExtensionContext) => builtin.execute(transform?.(context) ?? context),
    })) };
  } }] });
  for (const command of basicCommands()) shell.register(command);
  return { fs, shell };
}

const cases = [
  { name: "zero count clears array without consuming", before: "values=(old keep);", args: "-aname -a values -n0", input: "one two\ntail\n", after: 'printf "%s:" "${#values[@]}"; read -r tail; printf "%s" "$tail"' },
  { name: "zero exact count clears array", before: "values=(old keep);", args: "-N0 -a values", input: "one\n", after: 'printf "%s:" "${#values[@]}"; read -r tail; printf "%s" "$tail"' },
  { name: "repeated array selects only the final target", before: "first=(old keep); second=(stale);", args: "-a first -ra second", input: "a\\ b c\n", after: 'printf "<%s>" "${first[@]}" "${second[@]}"' },
  { name: "later invalid scalar names are ignored with array", before: "other=old;", args: "-a values other bad-name", input: "one two\n", after: 'printf "<%s>" "${values[@]}" "$other"' },
  { name: "readonly later scalar retains earlier assignment", before: "readonly last=old; first=before;", args: "first last", input: "one two\nTAIL\n", after: 'read -r tail; printf "<%s><%s><%s>" "$first" "$last" "$tail"' },
  { name: "readonly array at partial EOF keeps cells", before: "values=(old keep); readonly values;", args: "-a values", input: "one two", after: 'printf "<%s>" "${values[@]}"' },
  { name: "duplicate scalar names publish in order", args: "value value", input: "one two three\n", after: 'printf "<%s>" "$value"' },
  { name: "nonwhitespace IFS last scalar remainder", before: "IFS=:;", args: "first last", input: "::a::b:\n", after: 'printf "<%s><%s>" "$first" "$last"' },
  { name: "raw IFS escaped delimiters remain separators", before: "IFS=:;", args: "-ra values", input: "a\\:b::c\n", after: 'printf "<%s>" "${values[@]}"' },
  { name: "nonraw IFS escaped delimiters remain literal", before: "IFS=:;", args: "-a values", input: "a\\:b::c\n", after: 'printf "<%s>" "${values[@]}"' },
  { name: "embedded NUL plus count leaves exact tail", args: "-rn2 value", input: "a\0bc\n", after: 'read -r tail; printf "<%s><%s>" "$value" "$tail"' },
  { name: "NUL delimiter leaves raw following bytes", args: "-rd '' value", input: "a\0b\0c\n", after: 'read -r tail; printf "<%s><%s>" "$value" "$tail"' },
  { name: "exact count ignores selected delimiter", args: "-rd: -N4 value", input: "a:b\nc\n", after: 'read -r tail; printf "<%s><%s>" "$value" "$tail"' },
  { name: "count remains exact after repeated n", args: "-N5 -n3 -n2 value", input: "a\nbc\n", after: 'read -r tail; printf "<%s><%s>" "$value" "$tail"' },
  { name: "signed ASCII whitespace decimal count", args: "-n $'\\t+0002\\r' value", input: "abcd\n", after: 'read -r tail; printf "<%s><%s>" "$value" "$tail"' },
  { name: "negative zero count", args: "-n-0 value", input: "abcd\n", after: 'read -r tail; printf "<%s><%s>" "$value" "$tail"' },
  { name: "count at partial EOF assigns array", args: "-n9 -a values", input: "one two", after: 'printf "<%s>" "${values[@]}"' },
  { name: "descriptor aliases retain unread count tail", args: "-u3 -n2 first 3<&0", input: "abcd\n", after: 'read -r tail; printf "<%s><%s>" "$first" "$tail"' },
  { name: "invalid earlier descriptor beats later valid descriptor", args: "-u9 -u0 value", input: "one\n", after: 'read -r tail; printf "<%s>" "$tail"' },
  { name: "invalid later descriptor leaves first cursor untouched", args: "-u0 -u9 value", input: "one\n", after: 'read -r tail; printf "<%s>" "$tail"' },
  { name: "attached high-byte delimiter preserves bytes", args: "-rd$'\\xff' value", input: Uint8Array.of(128, 255, 254, 10), after: 'read -r tail; printf "%s%s" "$value" "$tail"' },
  { name: "invalid byte fields survive indexed publication", args: "-ra values", input: Uint8Array.of(255, 32, 254, 32, 128, 10), after: 'printf "%s" "${values[@]}"' },
  ...["n", "N", "u"].flatMap(flag => ["\\n", "\\r", "\\v", "\\f", "\\t", " "].flatMap(whitespace => ["leading", "trailing"].map(side => {
    const number = flag === "u" ? "0" : "2";
    const value = side === "leading" ? `${whitespace}${number}` : `${number}${whitespace}`;
    return { name: `numeric -${flag} ${side} whitespace ${JSON.stringify(whitespace)}`,
      args: `-${flag} $'${value}' value`, input: "abcd\n", after: 'read -r tail; printf "<%s><%s>" "$value" "$tail"',
    };
  }))),
  ...["-n0x0", "-n--", "-n2x", "-u+", "-N2147483648", "-u0x0", "-n $'2\\u00a0'"].map(args => ({
    name: `invalid numeric ${args}`, args, input: "one\n", after: 'read -r tail; printf "<%s>" "$tail"',
  })),
];

for (const entry of cases) {
  test(`read review: exact native comparison through test-only leaf alias: ${entry.name}`, async () => {
    const script = (builtin: string) => `${"before" in entry ? entry.before : ""} ${builtin} ${entry.args}; printf '%s:' "$?"; ${entry.after}`;
    const payload = typeof entry.input === "string" ? Buffer.from(entry.input) : entry.input;
    const native = primaryReference("review.test.ts", script("read"), payload);
    const subject = setup();
    try {
      await subject.fs.writeFile("/input", payload);
      const actual = await subject.shell.exec(`{ ${script("read_review")}; } </input`, { env: { LC_ALL: "C" } });
      assert.equal(actual.exitCode, native.status);
      assert.deepEqual(actual.stdoutBytes, new Uint8Array(native.stdout));
      assert.deepEqual(actual.stderrBytes, new Uint8Array(native.stderr));
    } finally { await subject.shell.dispose(); }
  });
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function owner(openIndexed: ShellExtensionContext["bindings"]["openIndexed"]) {
  const controller = new AbortController(), events: ShellValue[] = [], cleanups: (() => void | Promise<void>)[] = [];
  const record: ReadLine = { value: "one two", shellValue: "one two", escaped: new Set(), escapedByteOffsets: [],
    terminated: true, reason: "delimiter", fields: async () => [
      { start: 0, end: 3, value: "one" }, { start: 4, end: 7, value: "two" },
    ], release: async () => { events.push("record release"); },
  };
  const context: ShellExtensionContext = {
    command: "read", args: ["-a", "values"], argumentValues: ["-a", "values"], status: 0, functionDepth: 0, sourceDepth: 0,
    stdin: { async *[Symbol.asyncIterator]() { yield new Uint8Array(); } },
    stdout: { write: async () => {} }, stderr: { write: async () => {} }, scope: {}, signal: controller.signal,
    bindings: { describe: () => ({ kind: "scalar", readonly: false, exported: true }), get: () => undefined,
      assign: async () => { throw new Error("unexpected scalar assignment"); },
      prepareReference: async () => { throw new Error("unexpected reference binding"); },
      prepare: async () => { throw new Error("unexpected transaction"); }, openIndexed,
    },
    input: { observe() { throw new Error("Unexpected descriptor observation"); }, validateOpen(descriptor) { controller.signal.throwIfAborted(); assert.equal(descriptor, 0); }, borrow() {
      assert.equal(cleanups.length, 1);
      return { read: async () => record,
        record: async () => { throw new Error("unexpected raw record"); },
        readiness: () => { throw new Error("unexpected readiness"); },
        release: async () => { events.push("input release"); } };
    } },
    evaluate: async () => { throw new Error("unexpected evaluate"); }, variable: () => undefined,
    accountSource: () => {}, diagnostic: async message => { events.push(message); },
    registerCleanup: cleanup => { cleanups.push(cleanup); },
  };
  return { context, controller, events, cleanups, record,
    execute: () => Promise.resolve(readExtension().create().builtins[0]!.execute(context)),
  };
}

for (const reason of [undefined, false, 0, -0, "", null, NaN]) {
  test(`read review: partial writer failure retains exact primary reason ${String(reason)} negative-zero=${Object.is(reason, -0)}`, async () => {
    const values: ShellValue[] = [];
    const closeReason = new Error("secondary writer close");
    const subject = owner(async (name, options) => {
      assert.equal(name, "values"); assert.equal(options?.clear, true);
      return { set: async (index, value) => { if (index === 1) throw reason; values.push(value); },
        close: async () => { subject.events.push("writer close"); throw closeReason; },
      };
    });
    await assert.rejects(subject.execute(), error => Object.is(error, reason));
    assert.deepEqual(values.map(value => [...shellValueBytes(value)]), [[111, 110, 101]]);
    assert.deepEqual(subject.events, ["writer close", "record release", "input release"]);
    await assert.rejects(Promise.resolve().then(() => subject.cleanups[0]!()), error => error === closeReason);
    assert.deepEqual(subject.events, ["writer close", "record release", "input release"]);
  });
}

test("read review: cleanup joins a late indexed writer before rejecting further publication", async () => {
  const admitted = deferred<void>(), pending = deferred<ShellIndexedWriter>();
  const subject = owner(() => { admitted.resolve(); return pending.promise; });
  const execution = subject.execute();
  const rejected = assert.rejects(execution, /Read invocation is closed/);
  await admitted.promise;
  let closed = false;
  const closing = Promise.resolve(subject.cleanups[0]!()).then(() => { closed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  assert.deepEqual(subject.events, []);
  pending.resolve({ set: async () => { throw new Error("publication after close"); }, close: async () => { subject.events.push("writer close"); } });
  await Promise.all([rejected, closing]);
  assert.deepEqual(subject.events, ["writer close", "record release", "input release"]);
});

test("read review: cancellation drains admitted indexed set before releasing record and writer", async () => {
  const admitted = deferred<void>(), writing = deferred<void>();
  const subject = owner(async () => ({
    set: async index => { assert.equal(index, 0); admitted.resolve(); await writing.promise; },
    close: async () => { subject.events.push("writer close"); },
  }));
  const execution = subject.execute();
  const rejected = assert.rejects(execution, reason => reason === false);
  await admitted.promise;
  subject.controller.abort(false);
  let closed = false;
  const closing = Promise.resolve(subject.cleanups[0]!()).then(() => { closed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  assert.deepEqual(subject.events, []);
  writing.reject(new Error("late set failure"));
  await Promise.all([rejected, closing]);
  assert.deepEqual(subject.events, ["writer close", "record release", "input release"]);
});

test("read review: actual Shell input budget rejects before indexed writer acquisition", async () => {
  let acquired = 0;
  const subject = setup(context => ({ ...context, bindings: { ...context.bindings,
    openIndexed: async (...args) => { acquired++; return context.bindings.openIndexed(...args); },
  } }), { maxOutputBytes: 2 });
  try {
    await subject.fs.writeFile("/input", Buffer.from("one two\n"));
    await assert.rejects(subject.shell.exec("read_review -a values </input"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(acquired, 0);
  } finally { await subject.shell.dispose(); }
});

test("read review: exported scalar promotion stays exported through the generic writer", async () => {
  let inspected = false;
  const subject = setup(context => ({ ...context, bindings: { ...context.bindings,
    openIndexed: async (...args) => {
      assert.deepEqual(context.bindings.describe("values"), { kind: "scalar", readonly: false, exported: true });
      const writer = await context.bindings.openIndexed(...args);
      return { set: (index, value) => writer.set(index, value), close: async () => {
        await writer.close();
        assert.deepEqual(context.bindings.describe("values"), { kind: "indexed", readonly: false, exported: true });
        inspected = true;
      } };
    },
  } }));
  try {
    await subject.fs.writeFile("/input", Buffer.from("one two\n"));
    const result = await subject.shell.exec('export values=old; read_review -a values </input; printf "<%s>" "${values[@]}"');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "<one><two>");
    assert.equal(result.stderr, "");
    assert.equal(inspected, true);
  } finally { await subject.shell.dispose(); }
});

test("read review: source identity does not authorize public builtin replacement", async () => {
  const definition = readExtension();
  assert.equal(definition.runtimeIdentity, commandRuntimeIdentity);
  assert.equal(definition.create().builtins[0]!.name, "read");
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => {
      const { replace, ...withoutReplacement } = builtin;
      assert.equal(replace, true);
      return withoutReplacement;
    }) };
  } }] });
  try { await assert.rejects(shell.exec("read value"), /Extension builtin conflicts with existing builtin: read/); }
  finally { await shell.dispose(); }
});
