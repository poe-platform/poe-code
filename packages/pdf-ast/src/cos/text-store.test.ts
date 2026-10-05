import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { cosString } from "../ast.js";
import { serializeCosNodeBytes } from "./writer.js";
import { PdfTextStore } from "./text-store.js";

it.each(["", "café\\\n()".repeat(2048), "a".repeat(8191) + "😀日".repeat(4096)])("retains text and preserves string serialization (%#)", async text => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfTextStore({ fs, directory: "/scratch" });
  async function* chunks() { for (let at = 0; at < text.length; at += 31) yield text.slice(at, at + 31); }
  try {
    const id = await store.append(chunks());
    for (let attempt = 0; attempt < 2; attempt++) {
      let actual = ""; for await (const part of store.text(id)) { expect(part.length).toBeLessThanOrEqual(4096); actual += part; }
      expect(actual).toBe(text);
      const bytes = []; for await (const part of store.serialized(id)) { expect(part.length).toBeLessThanOrEqual(16384); bytes.push(part); }
      expect(new Uint8Array(Buffer.concat(bytes))).toEqual(serializeCosNodeBytes(cosString(text)));
    }
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
it("rejects unknown text identities, quota exhaustion and access after close", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfTextStore({ fs, directory: "/scratch" }, { maxStagingBytes: 16384 });
  try {
    await expect(store.text(0).next()).rejects.toThrow();
    await expect(store.append("A".repeat(32768))).rejects.toMatchObject({ code: "E_LIMIT" });
  } finally { await store.close(); }
  await expect(store.append("late")).rejects.toThrow();
  expect(await fs.readdir("/scratch")).toEqual([]);
});
it("does not publish a failed input and releases its caller backing", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfTextStore({ fs, directory: "/scratch" });
  const reason = new Error("input failed");
  async function* broken() { yield "a".repeat(8192); throw reason; }
  try {
    await expect(store.append(broken())).rejects.toBe(reason);
    const id = await store.append("kept"); expect(id).toBe(0);
    let actual = ""; for await (const part of store.text(id)) actual += part; expect(actual).toBe("kept");
  } finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
it("coalesces tiny input chunks within the same text storage budget", async () => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const store = new PdfTextStore({ fs, directory: "/scratch" }, { maxStagingBytes: 131072 });
  async function* chunks() { for (let i = 0; i < 8192; i++) yield "x"; }
  try { const id = await store.append(chunks()); let length = 0; for await (const part of store.text(id)) length += part.length; expect(length).toBe(8192); }
  finally { await store.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
