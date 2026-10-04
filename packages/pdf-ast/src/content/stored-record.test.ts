import { expect, it } from "vitest";
import type { PdfPixelStorage } from "../ast.js";
import { readStoredItems, readStoredRecord, writeStoredRecord } from "./stored-record.js";

function backing(capacity: number) {
  const data = new Uint8Array(capacity);
  let end = 0;
  const storage: PdfPixelStorage = {
    allocate(length) {
      if (end + length > capacity) throw new Error("Expanded capture payload");
      const position = end;
      end += length;
      return position;
    },
    async read(position, length) {
      expect(length).toBeLessThanOrEqual(4096);
      return data.slice(position, position + length);
    },
    async write(position, bytes) {
      expect(bytes.length).toBeLessThanOrEqual(4096);
      data.set(bytes, position);
    }
  };
  return storage;
}

it.each(["bytes", "string"])("stores large %s without JSON expansion", async (kind) => {
  const payload =
    kind === "bytes" ? new Uint8Array(65536).fill(255) : "\0\ud800\uffff".repeat(16384);
  const storage = backing(
    (typeof payload === "string" ? payload.length * 2 : payload.length) + 256
  );
  const position = await writeStoredRecord(storage, { payload }, 42);
  expect(await readStoredRecord(storage, position)).toEqual({ value: { payload }, next: 42 });
});

it("preserves numbers, byte ownership, storage authority and ordinary marker-shaped dictionaries", async () => {
  const storage = backing(4096);
  const input = {
    storage,
    bytes: new Uint8Array([0, 128, 255]),
    numbers: [NaN, Infinity, -Infinity, -0],
    dictionary: { $pdfBytes: [1, 2], $pdfNumber: "12" },
    omitted: undefined,
    array: [undefined, null, true, false],
    text: "\ufeffa\ud800\udfff",
    nested: { empty: [] }
  };
  const position = await writeStoredRecord(storage, input);
  const { value } = await readStoredRecord<typeof input>(storage, position);
  expect(value).toEqual({ ...input, array: [null, null, true, false] });
  expect(value.storage).toBe(storage);
  expect(value.bytes).not.toBe(input.bytes);
  expect(Object.hasOwn(value, "omitted")).toBe(false);
  await expect(writeStoredRecord(storage, { storage: backing(1) })).rejects.toThrow(
    "share caller backing"
  );
});

it("propagates backing failures and cancellation", async () => {
  const storage = backing(32768),
    controller = new AbortController();
  const failure = new Error("backend offline");
  await expect(
    writeStoredRecord(
      {
        ...storage,
        write: async () => {
          throw failure;
        }
      },
      1
    )
  ).rejects.toBe(failure);
  const position = await writeStoredRecord(storage, "a".repeat(8192));
  await expect(
    readStoredRecord(
      {
        ...storage,
        read: async () => {
          throw failure;
        }
      },
      position
    )
  ).rejects.toBe(failure);
  const read = storage.read;
  storage.read = async (...args) => {
    const bytes = await read(...args);
    controller.abort(failure);
    return bytes;
  };
  await expect(readStoredRecord(storage, position, controller.signal)).rejects.toBe(failure);
});

it("round trips own prototype-named keys without changing the decoded prototype", async () => {
  const storage = backing(1024),
    input = Object.create(null) as Record<string, unknown>;
  input.__proto__ = { ordinary: true };
  Object.defineProperty(input, "constructor", { value: "ordinary", enumerable: true });
  const position = await writeStoredRecord(storage, input);
  const { value } = await readStoredRecord<Record<string, unknown>>(storage, position);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.hasOwn(value, "__proto__")).toBe(true);
  expect(value.__proto__).toEqual({ ordinary: true });
  expect(value.constructor).toBe("ordinary");
});

it("rejects cycles and truncated backing records", async () => {
  const storage = backing(1024),
    cycle: unknown[] = [];
  cycle.push(cycle);
  await expect(writeStoredRecord(storage, cycle)).rejects.toThrow("Cyclic");
  const position = await writeStoredRecord(storage, { data: new Uint8Array([1, 2, 3]) });
  const read = storage.read;
  storage.read = async (...args) => (await read(...args)).subarray(1);
  await expect(readStoredRecord(storage, position)).rejects.toThrow("Incomplete capture header");
});

it.each([-1, NaN, 0.5])("rejects an invalid array element count before reading: %s", async length => {
  const storage: PdfPixelStorage = { allocate() { throw new Error("unexpected allocation"); }, async read() { throw new Error("unexpected read"); }, async write() { throw new Error("unexpected write"); } };
  await expect(readStoredItems({ storage, position: -1, length }).next()).rejects.toThrow("Invalid stored array length");
});


it.each(["measure", "write", "read", "items"])("allows timer cancellation during stored record %s", async (operation) => {
  const storage = backing(2 * 1024 * 1024);
  const payload = new Uint8Array(1024 * 1024);
  const position = operation === "read" ? await writeStoredRecord(storage, payload) : -1;
  let head = -1;
  if (operation === "items") {
    for (let i = 0; i < 8192; i++) head = await writeStoredRecord(storage, i, head);
  }
  const controller = new AbortController(), failure = new Error("timer cancellation");
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (operation === "write") {
    const write = storage.write;
    storage.write = async (...args) => {
      timer ??= setTimeout(() => controller.abort(failure), 0);
      await write(...args);
    };
  } else timer = setTimeout(() => controller.abort(failure), 0);
  try {
    const work = operation === "write" || operation === "measure" ? writeStoredRecord(storage, payload, -1, controller.signal)
      : operation === "read" ? readStoredRecord(storage, position, controller.signal)
      : (async () => {
        for await (const value of readStoredItems({ storage, position: head, length: 8192 }, controller.signal)) void value;
      })();
    await expect(work.then(() => "completed")).rejects.toBe(failure);
  } finally { clearTimeout(timer); }
});


it("round trips deeply nested captures with iterative traversal", async () => {
  const depth = 8192, storage = backing(depth * 32);
  let input: unknown = 42;
  for (let i = 0; i < depth; i++) input = i % 2 ? { child: input } : [input];
  const position = await writeStoredRecord(storage, input);
  let { value } = await readStoredRecord<unknown>(storage, position);
  for (let i = depth - 1; i >= 0; i--) value = i % 2
    ? (value as { child: unknown }).child : (value as unknown[])[0];
  expect(value).toBe(42);
});


it("allows shared children while rejecting back-edges during iterative capture", async () => {
  const storage = backing(4096), child = { bytes: new Uint8Array([1, 2, 3]) };
  const value = { first: child, second: [child, child] };
  const position = await writeStoredRecord(storage, value);
  expect((await readStoredRecord(storage, position)).value).toEqual(value);
  const cycle: unknown[] = [child]; cycle.push({ parent: cycle });
  await expect(writeStoredRecord(storage, cycle)).rejects.toThrow("Cyclic capture value");
  const after = await writeStoredRecord(storage, child);
  expect((await readStoredRecord(storage, after)).value).toEqual(child);
});
