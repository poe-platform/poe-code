import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type { InvocationContext } from "./engine.js";
import type { CsvkitWritableFile } from "./contracts.js";
import { defaultLimits, run } from "./engine.js";
import { csvcut } from "./commands/csvcut.js";
import { Runtime } from "./runtime.js";
import { CsvkitOutputBudgetError } from "./errors.js";
import { readCsvStream, type CsvDialect } from "./csv.js";
import { utf8Codec } from "./codecs/utf8.js";

function fixture(overrides: Partial<InvocationContext> = {}) {
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const cleanups: (() => Promise<void>)[] = [];
  const context: InvocationContext = {
    cwd: "/work", fs: { readFile: async () => { throw new Error("unexpected read"); }, writeFile: async () => { throw new Error("unexpected write"); } },
    stdin: (async function* () {})(), stdinIsDefault: true,
    stdout: { write: async bytes => { output.push(Uint8Array.from(bytes)); } }, stderr: { write: async bytes => { errors.push(Uint8Array.from(bytes)); } },
    terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
    env: {}, codecs: [], compression: [], databases: [],
    locale: { profile: "C", timezone: "UTC", formatNumber: String }, clock: { now: () => 0 },
    limits: defaultLimits, signal: new AbortController().signal,
    registerCleanup: cleanup => { cleanups.push(cleanup); }, ...overrides
  };
  return { runtime: new Runtime(context, csvcut, {}), output, errors, cleanups };
}

test("row admission denies before CR normalization allocates a split array", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxOutputBytes: 0 } });
  const split = vi.spyOn(String.prototype, "split");
  try {
    await assert.rejects(f.runtime.row(["a\rb"]), CsvkitOutputBudgetError);
    assert.equal(split.mock.calls.length, 0);
    assert.deepEqual(f.output, []);
  } finally { split.mockRestore(); await f.runtime.close(); }
});

test("row admission counts surrogate pairs across fields and terminators", async () => {
  for (const [cells, dialect, expected] of [
    [["\ud83d", ""], { delimiter: "\udca0", lineterminator: "" }, "💠"],
    [["\ud83d"], { lineterminator: "\udca0" }, "💠"]
  ] as const) {
    const f = fixture({ limits: { ...defaultLimits, maxOutputBytes: 4 } });
    try {
      await f.runtime.row(cells, dialect);
      assert.deepEqual(f.output, [new TextEncoder().encode(expected)]);
      await assert.rejects(f.runtime.write("x"), CsvkitOutputBudgetError);
    } finally { await f.runtime.close(); }
  }
});

test("row admission preserves native serialization errors before byte denial", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxOutputBytes: 0 } });
  try {
    await assert.rejects(f.runtime.row(["first", "a,b"], { quoting: 3 }), /need to escape/);
    await assert.rejects(f.runtime.row(["first", { kind: "timedelta", microseconds: 86400000000000000000n }]), /timedelta days out of range/);
  } finally { await f.runtime.close(); }
});

test("session admission stress: denied UTF-8 output never allocates an encoded buffer", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxOutputBytes: 2 } });
  const encode = vi.spyOn(TextEncoder.prototype, "encode");
  try {
    await assert.rejects(f.runtime.write("💠"), CsvkitOutputBudgetError);
    assert.equal(encode.mock.calls.length, 0);
    assert.deepEqual(f.output, []);
  } finally { encode.mockRestore(); await f.runtime.close(); }
});

test("session admission stress: UTF-8 admission counts replacement surrogates and shared channels exactly", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxOutputBytes: 10 } });
  try {
    await f.runtime.write("é💠\ud800");
    await f.runtime.write("x", "stderr");
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    try {
      await assert.rejects(f.runtime.write("x"), CsvkitOutputBudgetError);
      assert.equal(encode.mock.calls.length, 0);
      assert.deepEqual([...f.output[0]!], [195, 169, 240, 159, 146, 160, 239, 191, 189]);
    } finally { encode.mockRestore(); }
  } finally { await f.runtime.close(); }
});

test("session admission stress: bulk side-file denial precedes join and encoder allocation", async () => {
  let writes = 0, advanced = false;
  const f = fixture({ limits: { ...defaultLimits, maxOutputBytes: 1 }, fs: {
    readFile: async () => { throw new Error("unexpected read"); }, writeFile: async () => { writes++; }
  } });
  function* chunks() { yield "é"; advanced = true; yield "later"; }
  const encode = vi.spyOn(TextEncoder.prototype, "encode");
  try {
    await assert.rejects(f.runtime.writeSideFile("out.csv", chunks()), CsvkitOutputBudgetError);
    assert.equal(encode.mock.calls.length, 0);
    assert.equal(advanced, false);
    assert.equal(writes, 0);
  } finally { encode.mockRestore(); await f.runtime.close(); }
});

test("session admission stress: concurrent side-file cleanup drains the admitted write exactly once", async () => {
  let admit!: () => void, finish!: () => void;
  const admitted = new Promise<void>(resolve => { admit = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let closes = 0;
  const f = fixture({ fs: {
    readFile: async () => { throw new Error("unexpected read"); }, writeFile: async () => { throw new Error("unexpected bulk write"); },
    openWriteFile: async () => ({ write: async () => { admit(); await pending; }, close: async () => { closes++; } })
  } });
  const writing = f.runtime.writeSideFile("out.csv", ["x"]);
  await admitted;
  let settled = false;
  const closing = Promise.all(f.cleanups.map(close => close())).then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(closes, 0);
  finish();
  await assert.rejects(writing, /invocation already closed/);
  await closing;
  await Promise.all(f.cleanups.map(close => close()));
  assert.equal(closes, 1);
});

test("session admission stress: bulk side-file joins surrogate pairs across producer chunks", async () => {
  let written: Uint8Array | undefined;
  const f = fixture({ limits: { ...defaultLimits, maxOutputBytes: 4 }, fs: {
    readFile: async () => { throw new Error("unexpected read"); },
    writeFile: async (_path, bytes) => { written = Uint8Array.from(bytes); }
  } });
  try {
    await f.runtime.writeSideFile("out.csv", ["\ud83d", "", "\udca0"]);
    assert.deepEqual([...(written ?? [])], [240, 159, 146, 160]);
  } finally { await f.runtime.close(); }
});

test("session admission stress: reader column denial precedes excess field materialization", async () => {
  let steps = 0, closed = false;
  const dialect: CsvDialect & { columnBudget: number } = { columnBudget: 1 };
  const lines = (async function* () { try { yield "a,long field\n"; } finally { closed = true; } })();
  const reader = readCsvStream(lines, dialect, () => {
    if (++steps > 3) throw new Error("parsed excess field");
  });
  await assert.rejects(reader.next(), /column budget exceeded/);
  assert.equal(steps, 3);
  assert.equal(closed, true);
});

test("session admission stress: runtime passes its column budget into the CSV reader", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxColumns: 1, maxFieldCharacters: 1 }, stdin:
    (async function* () { yield Uint8Array.of(97, 44, 98, 98, 10); })(),
    codecs: [utf8Codec]
  });
  try {
    await assert.rejects(f.runtime.records(null).next(), /column budget exceeded/);
  } finally { await f.runtime.close(); }
});

test("session admission stress: excess raw rows are denied before their fields are accumulated", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxRows: 1, maxFieldCharacters: 1 },
    stdin: (async function* () { yield new TextEncoder().encode("a\nlong\n"); })(), codecs: [utf8Codec]
  });
  const reader = f.runtime.records(null);
  try {
    assert.deepEqual((await reader.next()).value?.cells, ["a"]);
    await assert.rejects(reader.next(), /row budget exceeded/);
  } finally { await f.runtime.close(); }
});

test("session admission stress: raw row admission is cumulative across distinct readers", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxRows: 1, maxFieldCharacters: 1 }, codecs: [utf8Codec], fs: {
    readFile: async path => new TextEncoder().encode(path.endsWith("one.csv") ? "a\n" : "long\n"),
    writeFile: async () => { throw new Error("unexpected write"); }
  } });
  try {
    const first = f.runtime.records("one.csv");
    assert.deepEqual((await first.next()).value?.cells, ["a"]);
    assert.equal((await first.next()).done, true);
    await assert.rejects(f.runtime.records("two.csv").next(), /row budget exceeded/);
  } finally { await f.runtime.close(); }
});

test("session admission stress: blank physical rows consume the raw row budget", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxRows: 1, maxFieldCharacters: 0 }, codecs: [utf8Codec],
    stdin: (async function* () { yield new TextEncoder().encode("\nx\n"); })()
  });
  try {
    const reader = f.runtime.records(null);
    assert.deepEqual((await reader.next()).value?.cells, []);
    await assert.rejects(reader.next(), /row budget exceeded/);
  } finally { await f.runtime.close(); }
});

test("session admission stress: recordLimit stops before an unneeded excess row", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxRows: 1, maxFieldCharacters: 1 }, codecs: [utf8Codec],
    stdin: (async function* () { yield new TextEncoder().encode("a\nlong\n"); })()
  });
  try {
    const reader = f.runtime.records(null, undefined, 0, false, 1);
    assert.deepEqual((await reader.next()).value?.cells, ["a"]);
    assert.equal((await reader.next()).done, true);
  } finally { await f.runtime.close(); }
});

test("session admission stress: multiline fields reserve one row and an empty source reserves none", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxRows: 1 }, codecs: [utf8Codec],
    stdin: (async function* () { yield new TextEncoder().encode('"a\nb"\n'); })(), fs: {
      readFile: async () => new Uint8Array(), writeFile: async () => { throw new Error("unexpected write"); }
    }
  });
  try {
    const reader = f.runtime.records(null);
    assert.deepEqual((await reader.next()).value?.cells, ["a\nb"]);
    assert.equal((await reader.next()).done, true);
    assert.equal((await f.runtime.records("empty.csv").next()).done, true);
  } finally { await f.runtime.close(); }
});

test("session admission stress: no-header output generation does not consume an extra input row", async () => {
  const f = fixture({ limits: { ...defaultLimits, maxRows: 1 }, codecs: [utf8Codec],
    stdin: (async function* () { yield new TextEncoder().encode("x\n"); })()
  });
  try {
    assert.equal(await run({ command: "csvcut", settings: { no_header_row: true } }, f.runtime.context), 0);
    assert.equal(f.output.map(bytes => new TextDecoder().decode(bytes)).join(""), "a\nx\n");
    assert.deepEqual(f.errors, []);
  } finally { await f.runtime.close(); }
});

for (const texts of [[], ["replacement"]]) {
  test(`session admission stress: synchronous local close prevents truncating open (${texts.length} chunks)`, async () => {
    const existing = Uint8Array.of(97, 98, 99);
    let contents = existing, registrations = 0, opens = 0, closes = 0;
    let closing: Promise<void> | undefined;
    const f = fixture({
      registerCleanup: close => { if (++registrations === 2) closing = close(); },
      fs: {
        readFile: async () => { throw new Error("unexpected read"); },
        writeFile: async () => { throw new Error("unexpected bulk write"); },
        openWriteFile: async () => {
          opens++; contents = new Uint8Array();
          return { write: async () => { throw new Error("unexpected write"); }, close: async () => { closes++; } };
        }
      }
    });
    try {
      await assert.rejects(f.runtime.writeSideFile("out.csv", texts), /side-file destination already closed/);
      await closing;
      assert.equal(opens, 0);
      assert.equal(closes, 0);
      assert.equal(contents, existing);
      assert.deepEqual([...contents], [97, 98, 99]);
    } finally { await closing; await f.runtime.close(); }
  });
}

test("session admission stress: local close during acquisition prevents source acquisition", async () => {
  let finish!: (file: CsvkitWritableFile) => void;
  const pending = new Promise<CsvkitWritableFile>(resolve => { finish = resolve; });
  let opens = 0, closes = 0, acquired = 0, advances = 0;
  const f = fixture({ fs: {
    readFile: async () => { throw new Error("unexpected read"); },
    writeFile: async () => { throw new Error("unexpected bulk write"); },
    openWriteFile: () => { opens++; return pending; }
  } });
  const texts: Iterable<string> = { [Symbol.iterator]: () => {
    acquired++;
    return { next: () => { advances++; return { done: false, value: "replacement" }; } };
  } };
  const invocation = f.runtime.writeSideFile("out.csv", texts);
  const rejection = assert.rejects(invocation, /side-file destination already closed/);
  const closing = f.cleanups[1]!();
  finish({ write: async () => { throw new Error("unexpected write"); }, close: async () => { closes++; } });
  try {
    await rejection; await closing;
    await f.cleanups[1]!();
    assert.equal(opens, 1);
    assert.equal(closes, 1);
    assert.equal(acquired, 0);
    assert.equal(advances, 0);
  } finally { await f.runtime.close(); }
});

test("session admission stress: local close during write drains it without another source advance", async () => {
  let start!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let closes = 0, advances = 0;
  const writes: Uint8Array[] = [];
  const f = fixture({ fs: {
    readFile: async () => { throw new Error("unexpected read"); },
    writeFile: async () => { throw new Error("unexpected bulk write"); },
    openWriteFile: async () => ({
      write: async bytes => { writes.push(Uint8Array.from(bytes)); start(); await pending; },
      close: async () => { closes++; }
    })
  } });
  function* texts() { advances++; yield "one"; advances++; yield "two"; }
  const invocation = f.runtime.writeSideFile("out.csv", texts());
  const rejection = assert.rejects(invocation, /side-file destination already closed/);
  await started;
  let settled = false;
  const closing = f.cleanups[1]!().then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(closes, 0);
  finish();
  try {
    await rejection; await closing;
    await f.cleanups[1]!();
    assert.equal(advances, 1);
    assert.equal(closes, 1);
    assert.deepEqual(writes.map(bytes => [...bytes]), [[111, 110, 101]]);
  } finally { await f.runtime.close(); }
});
