import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import type { ByteSource } from "../../../../src/contracts/index.js";
import { ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { authenticateOracle, nativeOptions } from "../trap/oracle.js";

let oracle: string | undefined;

function fixture(source: ByteSource, controller = new AbortController(), bytes = 65_536, fields = 4096) {
  const budget = new Budget({ ...defaultLimits, maxExpansionBytes: bytes, maxExpansionFields: fields, maxWallClockMs: 2000 }, controller.signal);
  const input = new ShellInput(source, budget);
  return { input, budget, async close() { try { await input.close(); } finally { budget.close(); budget.values.close(); } } };
}

function chunks(bytes: Uint8Array, size: number): ByteSource {
  return { async *[Symbol.asyncIterator]() { for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size); } };
}

const cases = [
  { name: "raw invalid byte", hex: "ff0a7461696c", raw: true, flags: "-r" },
  { name: "raw byte count", hex: "ff0a7461696c", raw: true, flags: "-rn1", count: 1 },
  { name: "UTF8 or byte count", hex: "c3a9f09f98800a7461696c", raw: true, flags: "-rn1", count: 1 },
  { name: "exact count crosses newline", hex: "ff0afe00740a", raw: true, flags: "-rN3", count: 3, exact: true },
  { name: "custom delimiter", hex: "ff3afe0a", raw: true, flags: "-rd:", delimiter: 58 },
  { name: "NUL delimiter", hex: "ff00fe0a", raw: true, flags: "-rd ''", delimiter: 0 },
  { name: "NUL ignored", hex: "00ff000afe", raw: true, flags: "-r" },
  { name: "NUL does not count", hex: "00ff00fe0a", raw: true, flags: "-rn2", count: 2 },
  { name: "escaped space and byte", hex: "ff5c205cfe0a7461696c", raw: false, flags: "" },
  { name: "escaped delimiter", hex: "ff5c3afe3a7461696c", raw: false, flags: "-d:", delimiter: 58 },
  { name: "continuation across chunks", hex: "ff5c0afe0a7461696c", raw: false, flags: "" },
  { name: "count excludes escape prefix", hex: "5cfffe0a", raw: false, flags: "-n1", count: 1 },
  { name: "raw slash", hex: "5cff0a", raw: true, flags: "-rn1", count: 1 },
  { name: "partial EOF", hex: "fffe", raw: true, flags: "-rn3", count: 3 },
  { name: "empty EOF", hex: "", raw: true, flags: "-r" },
  { name: "zero count", hex: "ff0a", raw: true, flags: "-rN0", count: 0, exact: true },
  { name: "invalid continuation consumes native unit", hex: "c30a7461696c", raw: true, flags: "-rn1", count: 1 },
  { name: "truncated multibyte EOF", hex: "e282", raw: true, flags: "-rn1", count: 1 },
  { name: "escaped NUL", hex: "5c00410a7461696c", raw: false, flags: "-n1", count: 1 },
  { name: "trailing escape EOF", hex: "5c", raw: false, flags: "" },
  { name: "prefixed trailing escape EOF", hex: "61625c", raw: false, flags: "-N4", count: 4, exact: true },
  { name: "prefixed escaped NUL", hex: "615c00420a", raw: false, flags: "" },
] as const;

for (const locale of ["C", "en_US.UTF-8"]) for (const entry of cases) {
  test(`byte read native ${locale}: ${entry.name}`, { ...nativeOptions(), timeout: 2000 }, async () => {
    const bytes = Buffer.from(entry.hex, "hex");
    const native = spawnSync(oracle ??= authenticateOracle(), ["--noprofile", "--norc", "-c", `IFS= read ${entry.flags} value; status=$?; printf '%s\\0%s\\0' "$status" "$value"; /bin/cat`], {
      input: bytes, env: { PATH: "/usr/bin:/bin", LC_ALL: locale }, timeout: 1000, maxBuffer: 4096,
    });
    assert.equal(native.error, undefined);
    assert.equal(native.signal, null);
    assert.equal(native.status, 0);
    assert.equal(native.stderr.length, 0);
    for (const size of [1, 2, 7]) {
      const subject = fixture(chunks(bytes, size));
      try {
        const result = await subject.input.line(entry.raw, {
          byteCount: locale === "C",
          ...("count" in entry ? { count: entry.count } : {}),
          ...("delimiter" in entry ? { delimiter: entry.delimiter } : {}),
          ...("exact" in entry ? { exact: entry.exact } : {}),
        });
        const remainder: Uint8Array[] = [];
        for await (const chunk of subject.input) remainder.push(chunk);
        const actual = Buffer.concat([Buffer.from(result.terminated ? "0\0" : "1\0"), shellValueBytes(result.shellValue), Buffer.from([0]), ...remainder]);
        assert.deepEqual(actual, native.stdout, `chunk size ${size}`);
        result.release();
        assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
      } finally { await subject.close(); }
    }
  });
}

test("read result owns producer bytes and exposes stable byte field ranges", async () => {
  const reusable = Uint8Array.of(255, 32, 92, 32);
  const subject = fixture({ async *[Symbol.asyncIterator]() {
    yield reusable;
    reusable.set([254, 58, 58, 10]);
    yield reusable;
    reusable.fill(65);
  } });
  try {
    const result = await subject.input.line(false, { byteCount: true });
    await subject.input.next();
    assert.equal(result.value, "\ufffd  \ufffd::");
    assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(255, 32, 32, 254, 58, 58));
    assert.deepEqual(result.escapedByteOffsets, [2]);
    assert.deepEqual([...result.escaped], [2]);
    assert.equal(Object.isFrozen(result.escapedByteOffsets), true);
    const fields = await result.fields(" :");
    assert.deepEqual(fields.map(field => [field.start, field.end, Buffer.from(shellValueBytes(field.value)).toString("hex")]), [[0, 1, "ff"], [2, 4, "20fe"], [5, 5, ""]]);
    result.release();
    result.release();
    await assert.rejects(result.fields(" "), /closed|released/);
  } finally { await subject.close(); }
});

test("byte fields distinguish raw delimiters and preserve named-variable remainder", async () => {
  const subject = fixture(chunks(Uint8Array.of(255, 254, 65, 254, 254, 66, 254, 10), 2));
  try {
    const result = await subject.input.line(true, { byteCount: true });
    const ifs = shellValueFromBytes(Uint8Array.of(254));
    const all = await result.fields(ifs);
    assert.deepEqual(all.map(field => Buffer.from(shellValueBytes(field.value)).toString("hex")), ["ff", "41", "", "42"]);
    const named = await result.fields(ifs, 2);
    assert.deepEqual(named.map(field => Buffer.from(shellValueBytes(field.value)).toString("hex")), ["ff", "41fefe42fe"]);
  } finally { await subject.close(); }
});

test("sequential reads do not pull ahead and borrowed input shares the existing cursor", async () => {
  let pulls = 0;
  const subject = fixture({ async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(255, 10, 254, 10); pulls++; yield Uint8Array.of(253, 10); } });
  const borrowed = new ShellInput(subject.input, subject.budget);
  try {
    const first = await borrowed.line(true, { byteCount: true });
    assert.equal(pulls, 1);
    assert.deepEqual(shellValueBytes(first.shellValue), Uint8Array.of(255));
    await borrowed.close();
    const second = await subject.input.line(true, { byteCount: true });
    assert.deepEqual(shellValueBytes(second.shellValue), Uint8Array.of(254));
    assert.equal(pulls, 1);
    const third = await subject.input.line(true, { byteCount: true });
    assert.deepEqual(shellValueBytes(third.shellValue), Uint8Array.of(253));
    assert.equal(pulls, 2);
  } finally { await borrowed.close(); await subject.close(); }
});

test("zero-count input leaves the producer untouched", async () => {
  let pulls = 0;
  const subject = fixture({ async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(255); } });
  try {
    const result = await subject.input.line(true, { count: 0, byteCount: true });
    assert.equal(result.terminated, true);
    assert.deepEqual(shellValueBytes(result.shellValue), new Uint8Array());
    assert.equal(pulls, 0);
  } finally { await subject.close(); }
});

test("falsey cancellation releases pending read allocations and preserves borrowed cursor work", async () => {
  let resolve!: (result: IteratorResult<Uint8Array>) => void;
  const subject = fixture({ [Symbol.asyncIterator]() { return { next: () => new Promise(completed => { resolve = completed; }) }; } });
  const controller = new AbortController();
  const borrowed = new ShellInput(subject.input, subject.budget, controller.signal);
  try {
    const pending = borrowed.line(true);
    while (!resolve) await Promise.resolve();
    controller.abort(false);
    await assert.rejects(pending, error => error === false);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
    resolve({ done: false, value: Uint8Array.of(255, 10) });
    const result = await subject.input.line(true);
    assert.deepEqual(shellValueBytes(result.shellValue), Uint8Array.of(255));
  } finally { await borrowed.close().catch(() => {}); await subject.close(); }
});

test("read allocations and field metadata share the existing expansion budget", async () => {
  const subject = fixture(chunks(Uint8Array.of(255, 10), 1), new AbortController(), 32, 4);
  try {
    await assert.rejects(subject.input.line(true), /maxExpansionBytes|maximum expansion/);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close().catch(() => {}); }
});

test("discarded NUL input yields so cancellation cannot wait for the entire chunk", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const subject = fixture(chunks(new Uint8Array(8192), 8192), controller);
  const timer = setImmediate(() => controller.abort(0));
  try {
    await assert.rejects(subject.input.line(true), error => error === 0);
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { clearImmediate(timer); await subject.close().catch(() => {}); }
});

const fieldCases = [
  { name: "named remainder", ifs: " \t\n", text: "  alpha  beta gamma  \n", raw: true, maximum: 2 },
  { name: "repeated trailing delimiters", ifs: ":", text: "a:b::\n", raw: true, maximum: 2 },
  { name: "empty indexed fields", ifs: ":", text: "::a:\n", raw: true },
  { name: "mixed separators", ifs: " :\t", text: " \ta : : b : \n", raw: true },
  { name: "escaped whitespace", ifs: " ", text: "a\\ b c\n", raw: false },
  { name: "empty indexed input", ifs: " :", text: " \t\n", raw: true },
  { name: "escaped UTF8 separator", ifs: "é", text: "α\\éβéγ\n", raw: false },
  { name: "escaped astral separator named remainder", ifs: "😀", text: "a\\😀b😀c😀d\n", raw: false, maximum: 2 },
  { name: "UTF8 separator byte mode", ifs: "é", text: "αéβéγ\n", raw: true },
] as const;

for (const locale of ["C", "en_US.UTF-8"]) for (const entry of fieldCases) {
  test(`read field boundaries native ${locale}: ${entry.name}`, { ...nativeOptions(), timeout: 2000 }, async () => {
    const maximum = "maximum" in entry ? entry.maximum : undefined;
    const assignment = maximum === undefined ? '-a values' : 'first second';
    const values = maximum === undefined ? '"${values[@]}"' : '"$first" "$second"';
    const script = `IFS=$1 read ${entry.raw ? "-r" : ""} ${assignment}; status=$?; printf '%s\\0' "$status"; for value in ${values}; do printf '%s\\0' "$value"; done`;
    const native = spawnSync(oracle ??= authenticateOracle(), ["--noprofile", "--norc", "-c", script, "shell", entry.ifs], {
      input: entry.text, env: { PATH: "/usr/bin:/bin", LC_ALL: locale }, timeout: 1000, maxBuffer: 4096,
    });
    assert.equal(native.error, undefined);
    assert.equal(native.signal, null);
    assert.equal(native.status, 0);
    assert.equal(native.stderr.length, 0);
    const subject = fixture(chunks(Buffer.from(entry.text), 1));
    try {
      const result = await subject.input.line(entry.raw, { byteCount: locale === "C" });
      const fields = await result.fields(entry.ifs, maximum);
      const payloads = fields.map(field => shellValueBytes(field.value));
      while (maximum !== undefined && payloads.length < maximum) payloads.push(new Uint8Array());
      assert.deepEqual(Buffer.concat([Buffer.from(result.terminated ? "0\0" : "1\0"), ...payloads.flatMap(value => [value, Uint8Array.of(0)])]), native.stdout);
    } finally { await subject.close(); }
  });
}

test("releasing a result during field scanning closes its allocation lifetime", async () => {
  const subject = fixture(chunks(Buffer.from(`${"a".repeat(2048)}\n`), 4096));
  try {
    const result = await subject.input.line(true);
    const pending = result.fields(" ", 0);
    const closing = result.release();
    assert.equal(result.release(), closing);
    assert.ok(subject.budget.values.usage.bytes > 0);
    await assert.rejects(pending, /closed/);
    await closing;
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("field scanning reuses admitted escape offsets across bounded fragment batches", async () => {
  const subject = fixture(chunks(Buffer.from(`${"\\😀".repeat(4097)}\n`), 127), new AbortController(), 1_048_576, 10_000);
  try {
    const result = await subject.input.line(false);
    const fields = await result.fields(" \t\n", 1);
    assert.equal(fields.length, 1);
    assert.deepEqual(shellValueBytes(fields[0]!.value), new TextEncoder().encode("😀".repeat(4097)));
    await result.release();
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close(); }
});

test("the existing arena can retain a result value beyond input release", async () => {
  const subject = fixture(chunks(Uint8Array.of(255, 10), 1));
  const consumer = subject.budget.values.scope();
  try {
    const result = await subject.input.line(true);
    const held = consumer.hold(result.shellValue);
    result.release();
    await subject.input.close();
    assert.deepEqual(shellValueBytes(held.value), Uint8Array.of(255));
    assert.ok(subject.budget.values.usage.bytes > 0);
    consumer.close();
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { consumer.close(); await subject.close(); }
});

test("field-count capacity refuses metadata growth and release clears failed work", async () => {
  const subject = fixture(chunks(Buffer.from("a:b:c:d:e:f:g:h:i:j\n"), 64), new AbortController(), 65_536, 15);
  try {
    const result = await subject.input.line(true);
    await assert.rejects(result.fields(":"), /maxExpansionFields/);
    result.release();
    assert.deepEqual(subject.budget.values.usage, { bytes: 0, slots: 0 });
  } finally { await subject.close().catch(() => {}); }
});

test("a bounded read does not duplicate the producer's entire unread chunk", async () => {
  const producer = new Uint8Array(262_144).fill(65);
  const NativeBytes = Uint8Array;
  let fullCopies = 0;
  const subject = fixture(chunks(producer, producer.length), new AbortController(), 4096, 128);
  globalThis.Uint8Array = new Proxy(NativeBytes, {
    construct(target, argumentsList, newTarget) {
      const input: unknown = argumentsList[0];
      if (input instanceof NativeBytes && input.byteLength >= producer.byteLength) fullCopies++;
      return Reflect.construct(target, argumentsList, newTarget);
    },
  });
  try {
    const result = await subject.input.line(true, { count: 1, byteCount: true });
    assert.deepEqual(shellValueBytes(result.shellValue), NativeBytes.of(65));
    assert.equal(fullCopies, 0);
  } finally { globalThis.Uint8Array = NativeBytes; await subject.close(); }
});

test("source-line retention still owns fragments before advancing a reusable producer", async () => {
  const reused = Uint8Array.of(65, 66);
  const subject = fixture({ async *[Symbol.asyncIterator]() {
    yield reused;
    reused.set([67, 10]);
    yield reused;
    reused.fill(88);
  } });
  try {
    const line = await subject.input.sourceLine();
    await subject.input.next();
    assert.deepEqual(line, Uint8Array.of(65, 66, 67, 10));
  } finally { await subject.close(); }
});
