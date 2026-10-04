import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import { parseContentStream, type PdfContentEvent } from "./parser.js";
import { parseContentStreamEvents } from "./range-events.js";
import { serializeContentAst, serializeContentEventChunks } from "./serializer.js";

it.each([
  "q /Span << /MCID 7 /ActualText (label) >> BDC BT /F1 12 Tf (A) Tj (B) Tj ET EMC Q",
  "0 0 10 10 re W f BI /W 1 /H 1 /BPC 8 /CS /G ID a EI Q",
  "q BT /F1 12 Tf (A) Tj (B) Tj",
  "BT (A) Tj /Span BMC (B) Tj EMC (C) Tj ET",
  "BT (A) Tj q (B) Tj Q (C) Tj ET",
  "q /Tag BMC 1 2 m 3 4 l h f",
  "Q EMC 1 0 0 rg /F1 12 Tf",
  "BT [(A) /Ignored 3 true (B) [1 2] null] TJ ET",
  "BT [<00FF> 1.125 (hello\\\\world)] TJ ET",
])("serializes retained content with buffered bytes: %s", async text => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const signal = new AbortController().signal, storage = { fs, directory: "/scratch" };
  const paths = new PagedStorage({ fs, cwd: "/scratch", env: {}, signal }, 4);
  const input = new TextEncoder().encode(text), chunks: Uint8Array[] = [];
  try {
    const events = parseContentStreamEvents([input], storage, { pathStorage: paths, signal });
    for await (const chunk of serializeContentEventChunks(events, storage, { chunkBytes: 16, signal })) { expect(chunk.buffer.byteLength).toBeLessThanOrEqual(16); chunks.push(chunk); }
    expect(Buffer.concat(chunks)).toEqual(Buffer.from(serializeContentAst(parseContentStream(input))));
  } finally { await paths.close(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([8193, 131073])("serializes %i external string bytes with bounded reads and owned output", async length => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  let reads = 0, peakRead = 0, consumed = 0;
  const external = { async read(_at: number, count: number) { reads++; peakRead = Math.max(peakRead, count); return new Uint8Array(count).fill(40); }, allocate() { throw new Error("Unexpected allocation"); }, async write() { throw new Error("Unexpected write"); } };
  const events: PdfContentEvent[] = [{ kind: "text-object", end: true, commands: [{ kind: "show-text", token: { kind: "string", format: "literal", bytes: new Uint8Array(), storedBytes: { storage: external, position: 0, byteLength: length } } }] }];
  const stream = serializeContentEventChunks(events, { fs, directory: "/scratch" }, { chunkBytes: 1024 });
  const prefix = Buffer.from("BT\n("), suffix = Buffer.from(") Tj\nET");
  let previous: Uint8Array | undefined, copy: Uint8Array | undefined;
  for await (const bytes of stream) {
    if (previous) expect(Buffer.from(previous).equals(copy!)).toBe(true);
    expect(bytes.buffer.byteLength).toBeLessThanOrEqual(1024);
    const expected = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      const at = consumed++;
      expected[i] = (at < prefix.length ? prefix[at] : at < prefix.length + length * 2 ? (at - prefix.length) % 2 ? 40 : 92 : suffix[at - prefix.length - length * 2])!;
    }
    expect(Buffer.from(bytes).equals(expected)).toBe(true);
    previous = bytes; copy = bytes.slice(); const before = reads; await Promise.resolve(); expect(reads).toBe(before);
  }
  expect(consumed).toBe(prefix.length + length * 2 + suffix.length); expect(peakRead).toBeLessThanOrEqual(4096);
  expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["cancel", "limit", "stop", "source-error"])("cleans serialized group state on %s", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch");
  const controller = new AbortController(), reason = new Error("cancel serializer"); let closed = false, opens = 0, closes = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); opens++;
      return new Proxy(handle, { get(target, property) {
        if (property === "close") return async () => { closes++; await handle.close(); };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  async function* events(): AsyncGenerator<PdfContentEvent> {
    try { for (let i = 0; i < 5000; i++) yield { kind: "begin-group", group: { kind: "graphics-group", ops: [] } }; if (mode === "source-error") throw reason; }
    finally { closed = true; }
  }
  const stream = serializeContentEventChunks(events(), { fs: guarded, directory: "/scratch" }, { chunkBytes: 8192, maxOutputBytes: mode === "limit" ? 8192 : Infinity, signal: controller.signal });
  await stream.next(); expect(opens).toBeGreaterThan(0);
  if (mode === "stop") await stream.return(undefined);
  else { if (mode === "cancel") controller.abort(reason); await expect(stream.next()).rejects.toThrow(mode === "limit" ? "limit" : reason.message); }
  expect(closed).toBe(true); expect(closes).toBe(opens); expect(await fs.readdir("/scratch")).toEqual([]);
});
