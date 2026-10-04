import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosDict, cosNumber, cosString, decodePdfString, dictGet, dictSet } from "../ast.js";
import { PdfMutableObjectStore } from "./mutable-object-store.js";

it("reserves cyclic references, replaces objects and replays sorted owned values", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  try {
    const first = await store.allocate(), second = await store.allocate();
    const value = cosDict({ Next: second, Value: cosString("saved") });
    await store.set({ objectNumber: first.objectNumber, generationNumber: 0, value });
    await store.set({ objectNumber: second.objectNumber, generationNumber: 0, value: cosDict({ Next: first }) });
    dictSet(value, "Value", cosString("mutated"));
    const loaded = (await store.get(first.objectNumber))!;
    const saved = loaded.value.kind === "dict" ? dictGet(loaded.value, "Value") : undefined;
    expect(saved?.kind === "string" && decodePdfString(saved)).toBe("saved");
    if (loaded.value.kind === "dict") dictSet(loaded.value, "Next", cosNumber(0));
    const again = (await store.get(first.objectNumber))!;
    expect(again.value.kind === "dict" && dictGet(again.value, "Next")).toMatchObject({ kind: "ref", objectNumber: second.objectNumber, generationNumber: 0 });
    expect(await store.get(100)).toBeUndefined();
    const numbers = []; for await (const object of store.objects()) numbers.push(object.objectNumber);
    expect(numbers).toEqual([1, 2]);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("retains reused stream chunks and leaves the old value intact after a bad replacement", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  try {
    await store.set({ objectNumber: 9, generationNumber: 3, value: cosDict({}), stream: { length: 70000, chunks: (async function* () {
      const scratch = new Uint8Array(1000); for (let i = 0; i < 70; i++) { scratch.fill(i); yield scratch; }
    })() } });
    await expect(store.set({ objectNumber: 9, generationNumber: 0, value: cosDict({}), stream: { length: 4, chunks: [new Uint8Array(3)] } })).rejects.toThrow();
    const object = (await store.get(9))!; expect(object.generationNumber).toBe(3); expect(object.stream?.length).toBe(70000);
    let total = 0; for await (const bytes of object.stream!.chunks) { expect(bytes.length).toBeLessThanOrEqual(16384);
      expect(bytes.every((value, i) => value === Math.floor((total + i) / 1000))).toBe(true); total += bytes.length; bytes.fill(255); }
    expect(total).toBe(70000);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("admits backing before consuming a stream and preserves cancellation", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let consumed = false;
  const controller = new AbortController(), reason = new Error("stop edits");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { maxStagingBytes: 16, signal: controller.signal });
  try {
    await expect(store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({}), stream: { length: 100,
      chunks: (async function* () { consumed = true; yield new Uint8Array(100); })() } })).rejects.toThrow();
    expect(consumed).toBe(false); controller.abort(reason); await expect(store.get(1)).rejects.toBe(reason);
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("yields to timer cancellation while accepting reused payload chunks", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("cancel append");
  const store = new PdfMutableObjectStore({ fs, directory: "/scratch" }, { signal: controller.signal }); let consumed = 0;
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await expect(store.set({ objectNumber: 1, generationNumber: 0, value: cosDict({}), stream: { length: 2000 * 1024,
      chunks: (async function* () { const bytes = new Uint8Array(1024); for (let i = 0; i < 2000; i++) { consumed++; yield bytes; } })() } })).rejects.toBe(reason);
    expect(consumed).toBeLessThan(2000);
  } finally { clearTimeout(timer); await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it("preserves explicit hexadecimal string serialization through replacement snapshots", async () => {
  const { serializeCosNodeBytes } = await import("./writer.js");
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfMutableObjectStore({ fs, directory: "/scratch" });
  const value = cosDict({ Hex: { kind: "string", format: "hex", bytes: Uint8Array.of(0, 65, 255) }, Literal: cosString("text") });
  try { const ref = await store.allocate(value); expect(serializeCosNodeBytes((await store.get(ref.objectNumber))!.value)).toEqual(serializeCosNodeBytes(value)); }
  finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
