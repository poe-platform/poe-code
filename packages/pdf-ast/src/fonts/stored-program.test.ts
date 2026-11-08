import { expect, it } from "vitest";
import { StoredFontValues } from "./stored-values.js";
import { FontProgramStore } from "./stored-program.js";

function fixture(size = 16384) {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = i % 251;
  let maximum = 0,
    reads = 0;
  const storage = {
    allocate() {
      throw Error("source is already allocated");
    },
    async read(at: number, length: number) {
      maximum = Math.max(maximum, length);
      reads++;
      return data.slice(at, at + length);
    },
    async write(at: number, bytes: Uint8Array) {
      maximum = Math.max(maximum, bytes.length);
      data.set(bytes, at);
    }
  };
  return {
    data,
    storage,
    get maximum() {
      return maximum;
    },
    get reads() {
      return reads;
    }
  };
}

it("reads source slices with bounded detached caches and typed-array integer semantics", async () => {
  const f = fixture(),
    program = new FontProgramStore({ storage: f.storage, position: 0, byteLength: f.data.length });
  const range = program.range(17, 9001),
    bytes = f.data.subarray(17, 9001),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (const at of [0, 1, 4078, 4080, 8000]) {
    expect(await range.byte(at)).toBe(bytes[at]);
    expect(await range.int(at, 2)).toBe(view.getInt16(at));
    expect(await range.int(at, 4)).toBe(view.getInt32(at));
  }
  expect(await range.byte(range.length)).toBeUndefined();
  await expect(range.int(range.length - 1, 2)).rejects.toBeInstanceOf(RangeError);
  expect(f.maximum).toBeLessThanOrEqual(4096);
  expect(f.reads).toBeLessThan(10);
});

it("preserves overlapping repairs and shares writes between ranges", async () => {
  const f = fixture(),
    expected = f.data.slice(),
    program = new FontProgramStore({ storage: f.storage, position: 0, byteLength: f.data.length });
  const range = program.range(101, 12001),
    original = expected.subarray(101, 12001);
  for (const [target, start, end] of [
    [10, 11, -1],
    [1000, 0, 9000],
    [-4000, -3000, 12000]
  ] as const) {
    original.copyWithin(target, start, end);
    await range.copyWithin(target, start, end);
  }
  original.fill(14, 10000);
  await range.fill(14, 10000);
  original[4095] = 99;
  await range.writeByte(4095, 99);
  expect(await program.range(4196, 4197).byte(0)).toBe(99);
  await program.flush();
  expect(f.data).toEqual(expected);
  expect(f.maximum).toBeLessThanOrEqual(4096);
});

it("propagates read failures and cancellation without replacing their identity", async () => {
  const f = fixture(),
    reason = new Error("unavailable");
  const program = new FontProgramStore({
    storage: {
      ...f.storage,
      async read() {
        throw reason;
      }
    },
    position: 0,
    byteLength: f.data.length
  });
  await expect(program.range().byte(0)).rejects.toBe(reason);
  const controller = new AbortController();
  controller.abort(reason);
  const stopped = new FontProgramStore(
    { storage: f.storage, position: 0, byteLength: f.data.length },
    { signal: controller.signal }
  );
  await expect(stopped.range().byte(0)).rejects.toBe(reason);
});

it("interprets backed charstrings and subroutines without reading whole programs", async () => {
  const { Type2Compiled } = await import("../vendor/pdfjs-fonts.mjs");
  const f = fixture(65536);
  f.data.set([139, 139, 21, 32, 10, 14], 4094);
  f.data.set([149, 139, 5, 11], 50000);
  const program = new FontProgramStore({
    storage: f.storage,
    position: 0,
    byteLength: f.data.length
  });
  const code = program.range(4094, 4100),
    subr = program.range(50000, 50004);
  const renderer = new Type2Compiled({ glyphs: [code], subrs: [subr] }, [], [1, 0, 0, 1, 0, 0]);
  const work = renderer.glyphCommands(code, 0),
    actual: number[] = [];
  let step = work.next();
  while (!step.done) {
    if (step.value instanceof Promise) step = work.next(await step.value);
    else {
      actual.push(...Array.from(step.value));
      step = work.next();
    }
  }
  expect(actual).toEqual([0, 0, 0, 1, 10, 0, 4]);
  expect(f.maximum).toBeLessThanOrEqual(4096);
  expect(f.reads).toBeLessThan(8);
});

it.each([
  [139, 139, 21, 149, 139, 5, 0],
  [139, 139, 21, 9, 149, 139, 5, 14],
  [19, 139, 139, 21, 149, 139, 5, 14],
  [139, 139, 21, 12, 0, 149, 139, 5, 14],
  [32, 10, 14]
])("preserves native charstring repairs through caller ranges: %j", async (...code) => {
  const { CFFParser, Stream } = await import("../vendor/pdfjs-fonts.mjs");
  const expected = Uint8Array.from(code),
    actual = expected.slice();
  const storage = {
    allocate() {
      throw Error("unused");
    },
    async read(at: number, length: number) {
      return actual.slice(at, at + length);
    },
    async write(at: number, bytes: Uint8Array) {
      actual.set(bytes, at);
    }
  };
  const program = new FontProgramStore({ storage, position: 0, byteLength: actual.length });
  const state = () => ({
    callDepth: 0,
    stackSize: 0,
    stack: [] as number[],
    hints: 0,
    firstStackClearing: true,
    seac: null,
    width: null,
    hasVStems: false
  });
  const nativeState = state(),
    backedState = state(),
    parser = new CFFParser(new Stream(new Uint8Array()), {}, false);
  const native = parser as unknown as {
    parseCharString(state: unknown, bytes: Uint8Array, local: null, global: null): boolean;
  };
  const valid = native.parseCharString(nativeState, expected, null, null);
  const scratch = new Uint8Array(65536);
  let end = 0;
  const stack = new StoredFontValues({
    allocate(n) {
      const at = end;
      end += n;
      return at;
    },
    async read(at, length) {
      return scratch.slice(at, at + length);
    },
    async write(at, bytes) {
      scratch.set(bytes, at);
    }
  });
  const observed = { ...backedState, stack };
  const work = parser.parseCharStringSteps(observed, program.range(), null, null);
  let step = work.next();
  while (!step.done) step = work.next(await step.value);
  expect(step.value).toBe(valid);
  const { stack: ignoredNative, ...nativeMetadata } = nativeState;
  const { stack: ignoredBacked, ...backedMetadata } = observed;
  expect(backedMetadata).toEqual(nativeMetadata);
  await program.flush();
  expect(actual).toEqual(expected);
});
