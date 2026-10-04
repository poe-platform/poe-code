import { describe, expect, it, vi } from "vitest";
import type { FileSystem } from "@poe-code/safe-fs/contracts";
import { PdfFileSource } from "../source.js";
import { scanCosRangeObjects } from "./range-repair.js";

async function fixture(text: string, chunkBytes = 7) {
  const bytes = new TextEncoder().encode(text);
  const read = vi.fn(async (at: number, length: number) => bytes.slice(at, at + length));
  const close = vi.fn(async () => {});
  const fs = { capabilities: { retainedRead: true }, openReadFile: async () => ({
    stat: async () => ({ type: "file", size: bytes.length }), read, close,
  }) } as unknown as FileSystem;
  const source = await PdfFileSource.open(fs, "/input", { chunkBytes, cacheBytes: chunkBytes * 2 });
  return { source, read, close };
}

describe("retained repair discovery", () => {
  it.each([1, 7, 64])("discovers objects and trailers across %i-byte windows", async chunkBytes => {
    const f = await fixture("%PDF-1.7\n% 99 0 obj null endobj\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n1 2 obj << /Type /Catalog >> endobj", chunkBytes);
    const events = []; for await (const event of scanCosRangeObjects(f.source)) events.push(event);
    expect(events.map(event => event.kind)).toEqual(["object", "trailer", "object"]);
    expect(events[0]).toMatchObject({ object: { objectNumber: 1, generationNumber: 0 } });
    expect(events[2]).toMatchObject({ object: { objectNumber: 1, generationNumber: 2 } });
    expect(f.close).not.toHaveBeenCalled(); await f.source.close();
  });

  it("skips stream payloads and does not mistake contained headers for objects", async () => {
    const payload = "99 0 obj null endobj\ntrailer << /Root 99 0 R >>";
    const f = await fixture(`1 0 obj << /Length ${payload.length} >> stream\n${payload}\nendstream\nendobj\n2 0 obj true endobj`);
    const events = []; for await (const event of scanCosRangeObjects(f.source)) events.push(event);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ object: { objectNumber: 1, stream: { end: expect.any(Number) } } });
    expect(events[1]).toMatchObject({ object: { objectNumber: 2, value: { kind: "boolean", value: true } } });
    await f.source.close();
  });

  it("skips malformed fragments and respects header boundaries", async () => {
    const f = await fixture("x1 0 obj false endobj\n2 0 obj ! endobj\n3 0 obj[1] endobj\ntrailer nope\n4 0 obj null endobj");
    const objects = []; for await (const event of scanCosRangeObjects(f.source)) if (event.kind === "object") objects.push(event.object.objectNumber);
    expect(objects).toEqual([3, 4]); await f.source.close();
  });

  it("stops at consumer backpressure and preserves cancellation", async () => {
    const f = await fixture("1 0 obj true endobj\n" + " ".repeat(10000)); const controller = new AbortController();
    const iterator = scanCosRangeObjects(f.source, { signal: controller.signal });
    expect((await iterator.next()).value).toMatchObject({ kind: "object" });
    expect(Math.max(...f.read.mock.calls.map(([offset]) => offset))).toBeLessThan(64);
    controller.abort(new Error("stop scan")); await expect(iterator.next()).rejects.toThrow("stop scan");
    expect(f.close).not.toHaveBeenCalled(); await f.source.close();
  });

  it.each([65, 513])("discovers %i generated objects without a resident payload", async count => {
    const record = new TextEncoder().encode("1 0 obj true endobj\n"); let peak = 0;
    const fs = { capabilities: { retainedRead: true }, openReadFile: async () => ({
      stat: async () => ({ type: "file", size: count * record.length }), close: async () => {},
      read: async (at: number, length: number) => {
        peak = Math.max(peak, length); const result = new Uint8Array(Math.min(length, count * record.length - at));
        for (let i = 0; i < result.length; i++) result[i] = record[(at + i) % record.length]!;
        return result;
      },
    }) } as unknown as FileSystem;
    const source = await PdfFileSource.open(fs, "/generated", { chunkBytes: 64, cacheBytes: 128 });
    let seen = 0; for await (const event of scanCosRangeObjects(source)) { expect(event).toMatchObject({ kind: "object", object: { objectNumber: 1 } }); seen++; }
    expect(seen).toBe(count); expect(peak).toBeLessThanOrEqual(64); await source.close();
  });

  it("does not swallow structural admission errors as repairable syntax", async () => {
    const f = await fixture("1 0 obj [1 2 3] endobj");
    await expect(async () => { for await (const ignored of scanCosRangeObjects(f.source, { maxNodes: 2 })) void ignored; }).rejects.toThrow("limit");
    await f.source.close();
  });
});

it("preserves malformed-object recovery with bounded unknown keyword spellings",async()=>{
 const {CosRangeLexer}=await import("./lexer.js");
 const f=await fixture("1 0 obj "+"z".repeat(131072)+" endobj\n2 0 obj true endobj\ntrailer << /Root 2 0 R >>",4096);
 const original=CosRangeLexer.prototype.nextToken;let largest=0,truncated=0;
 const spy=vi.spyOn(CosRangeLexer.prototype,"nextToken").mockImplementation(async function(this:InstanceType<typeof CosRangeLexer>){const token=await original.call(this);if(token?.kind==="keyword"){largest=Math.max(largest,token.value.length);if(token.truncated)truncated++;}return token;});
 try{
  const events=[];for await(const event of scanCosRangeObjects(f.source,{compactKeywords:true}))events.push(event);
  expect(events).toMatchObject([{kind:"object",object:{objectNumber:2,value:{kind:"boolean",value:true}}},{kind:"trailer"}]);
  expect(largest).toBeLessThanOrEqual(65);expect(truncated).toBeGreaterThan(0);
 }finally{spy.mockRestore();await f.source.close();}
});
