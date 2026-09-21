import { expect, it } from "vitest";
import { createEngine, runCommand, type Codec, type RuntimeLimits } from "./index.js";

const limits: RuntimeLimits = { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10 };
const environment = { env: {}, locale: "C", timezone: "UTC" };
const book = { sheets: [{ id: "s", name: "S", cells: [] }] };
const codec: Codec = { id: "review", description: "Independent original fixture", extensions: ["csv"],
  probeContent: () => true, async read() { return book; }, async write() { return new Uint8Array([7, 8]); } };
const operation = () => ({ signal: new AbortController().signal });

it("refuses empty-chunk read amplification and closes the producer before importer dispatch", async () => {
  let closed = 0, imported = 0, reads = 0;
  const engine = createEngine({ limits: { ...limits, workbookWork: 4 }, environment,
    codecs: [{ ...codec, async read() { imported++; return book; } }] });
  const source = { *[Symbol.iterator]() {
    try { for (let index = 0; index < 5; index++) { reads++; yield new Uint8Array(); }
      yield new Uint8Array([1]); }
    finally { closed++; }
  } };
  await expect(engine.readWorkbook({ kind: "stream", source }, {}, operation())).rejects.toMatchObject({
    code: "resource-limit", message: "ssconvert input chunks limit exceeded"
  });
  expect({ closed, imported, reads }).toEqual({ closed: 1, imported: 0, reads: 5 });
  await engine.dispose();
});

it.each([{ source: [] }, { source: [new Uint8Array()] }, { source: [new Uint8Array([1]), new Uint8Array([2])] }])(
  "admits EOF and exact yielded chunk boundary %j", async ({ source }) => {
    let received: number[] = [];
    const engine = createEngine({ limits: { ...limits, inputBytes: 2, workbookWork: 2 }, environment,
      codecs: [{ ...codec, async read(bytes) { received = [...bytes]; return book; } }] });
    await engine.readWorkbook({ kind: "stream", source }, {}, operation());
    expect(received).toEqual(source.flatMap(bytes => [...bytes]));
    await engine.dispose();
  });

it("zero read-work permits immediate EOF and denies an empty yielded chunk", async () => {
  const engine = createEngine({ limits: { ...limits, inputBytes: 0, workbookWork: 0 }, environment, codecs: [codec] });
  await engine.readWorkbook({ kind: "stream", source: [] }, {}, operation());
  await expect(engine.readWorkbook({ kind: "stream", source: [new Uint8Array()] }, {}, operation())).rejects.toMatchObject({
    code: "resource-limit", message: "ssconvert input chunks limit exceeded"
  });
  await engine.dispose();
});

it("work refusal awaits asynchronous producer return settlement", async () => {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const closing = new Promise<void>(resolve => { entered = resolve; });
  const source = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false as const, value: new Uint8Array() }; },
    async return() { entered(); await gate; return { done: true as const, value: undefined }; }
  }; } };
  const engine = createEngine({ limits: { ...limits, workbookWork: 0 }, environment, codecs: [codec] });
  let settled = false;
  const execution = engine.readWorkbook({ kind: "stream", source }, {}, operation());
  const assertion = expect(execution).rejects.toMatchObject({ code: "resource-limit" });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  await closing;
  await Promise.resolve();
  expect(settled).toBe(false);
  release();
  await assertion;
  expect(settled).toBe(true);
  await engine.dispose();
});

it("accepts exactly the measured terminal byte boundary and refuses one less without stdout", async () => {
  async function help(maximum?: number) {
    const engine = createEngine({ limits: { ...limits, ...(maximum === undefined ? {} : { commandOutputBytes: maximum }) },
      environment, codecs: [codec] });
    const out: Uint8Array[] = [], errors: Uint8Array[] = [];
    const result = await runCommand(["--help"], engine, { ...operation(),
      stdout: { async write(bytes) { out.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes) { errors.push(new Uint8Array(bytes)); } } });
    await engine.dispose();
    return { result, out, errors };
  }
  const baseline = await help();
  const size = baseline.out.reduce((sum, bytes) => sum + bytes.byteLength, 0);
  expect(size).toBeGreaterThan(1);
  expect(await help(size)).toEqual(baseline);
  const refused = await help(size - 1);
  expect(refused.result).toEqual({ exitCode: 1 });
  expect(refused.out).toEqual([]);
  expect(new TextDecoder().decode(refused.errors[0])).toBe("ssconvert output bytes limit exceeded\n");
});

it("settles provider cleanup once before exposing an early sink failure", async () => {
  const events: string[] = [];
  const reason = new Error("independent sink refusal");
  const engine = createEngine({ limits, environment, codecs: [{ ...codec, async write(_book, _options, context) {
    context.own(async () => { await Promise.resolve(); events.push("released"); });
    events.push("encoded"); return new Uint8Array([7, 8]);
  } }] });
  const execution = engine.convert({ input: { kind: "stream", source: [new Uint8Array([1])] },
    destination: { kind: "stream", sink: { async write() { events.push("sink"); throw reason; } } },
    exportType: "review" }, operation());
  await expect(execution).rejects.toBe(reason);
  expect(events).toEqual(["encoded", "sink", "released"]);
  await engine.dispose();
});
