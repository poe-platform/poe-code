import { expect, it } from "vitest";
import { encodeId3, parseId3 } from "./id3.js";
import { probeId3Source, readId3Text, type Id3TextSpan } from "./id3-source.js";
import { cleanText } from "./binary.js";

function source(bytes: Uint8Array) {
  return { size: bytes.length, async read(offset: number, length: number) { expect(length).toBeLessThanOrEqual(16384); return bytes.slice(offset, offset + length); } };
}
function sync(n: number) { return [n >>> 21 & 127, n >>> 14 & 127, n >>> 7 & 127, n & 127]; }
function fixture(version: number, flags: number, frames: number[]) { return Uint8Array.from([73,68,51,version,0,flags,...sync(frames.length),...frames,...(version === 4 && flags & 16 ? [51,68,73,4,0,0,0,0,0,0] : [])]); }
function frame(version: number, id: string, data: number[], flags = 0) {
  return [...new TextEncoder().encode(id), ...(version === 2 ? [data.length >>> 16, data.length >>> 8 & 255, data.length & 255] : version === 4 ? sync(data.length) : [0,0,data.length >>> 8,data.length & 255]), ...(version === 2 ? [] : [flags >>> 8, flags & 255]), ...data];
}
async function compare(bytes: Uint8Array) {
  const input = source(bytes), spans: Id3TextSpan[] = [];
  const result = await probeId3Source(input, { onTag: async span => { spans.push(span); } });
  const tags: Record<string,string> = {};
  for (const span of spans) { let value = ""; for await (const part of readId3Text(input, span)) value += part; tags[span.key] = cleanText(value); }
  const expected = parseId3(bytes);
  expect({ ...result, tags }).toEqual({ size: expected.size, version: expected.version, tags: expected.tags });
  expect(await probeId3Source(input)).toEqual({ size: expected.size, version: expected.version, tags: expected.tags });
}
it("streams long text spans and skips image payload models", async () => {
  await compare(encodeId3({ title: "  é😀".repeat(10000) + "  ", comment: "note", TZZZ: "unknown" }, [], [{ type: 3, mime: "image/png", description: "picture", data: new Uint8Array(100000) }]));
});
for (const version of [2,3,4]) for (const encoding of [0,1,2,3]) it(`preserves v${version} encoding ${encoding} and duplicate replacement`, async () => {
  const text = encoding === 1 ? [255,254,65,0,66,0,0,0,67,0] : encoding === 2 ? [0,65,0,66,0,0,0,67] : [65,66,0,67];
  await compare(fixture(version,0,[...frame(version,version === 2 ? "TT2" : "TIT2",[3,88]),...frame(version,version === 2 ? "TT2" : "TIT2",[encoding,...text])]));
});
for (const version of [3,4]) it(`preserves version ${version} unsynchronization and prefixes`, async () => {
  const logical = frame(version,"TIT2",version === 3 ? [7,0,65,255,66] : [7,0,65,255,0,66],version === 3 ? 32 : 66);
  const data = version === 3 ? logical.flatMap(v=>v === 255 ? [255,0] : [v]) : logical;
  await compare(fixture(version,version === 3 ? 128 : 0,data));
});
it("handles global unsynchronization across read boundaries", async () => {
  const data = [0,...Array.from({length:20000},(_,i)=>i % 100 === 0 ? 255 : 65)];
  const logical = frame(3,"TIT2",data), physical = logical.flatMap(v=>v === 255 ? [255,0] : [v]);
  await compare(fixture(3,128,physical));
});
it("validates comments, pictures, footer and extended headers without exposing picture bytes", async () => {
  await compare(fixture(4,80,[...sync(6),0,0,...frame(4,"COMM",[3,101,110,103,100,0,97]),...frame(4,"APIC",[3,105,109,97,103,101,47,112,110,103,0,3,100,0,1,2,3])]));
});
it("preserves errors for invalid encodings, truncated frames and malformed pictures", async () => {
  const invalid = [fixture(4,0,frame(4,"TIT2",[9,65])),fixture(4,0,frame(4,"COMM",[3,101,110,103,65])),fixture(4,0,frame(4,"APIC",[3,65])),fixture(3,64,[0,0,0,1,0])];
  for (const bytes of invalid) { let message = ""; try { parseId3(bytes); } catch (error) { message = (error as Error).message; } expect(message).not.toBe(""); await expect(probeId3Source(source(bytes))).rejects.toThrow(message); }
});
it("propagates source/callback failures and cancellation without closing caller sources", async () => {
  const bytes = encodeId3({title:"value"});
  await expect(probeId3Source({size:bytes.length,async read(){throw new Error("source failure");}})).rejects.toThrow("source failure");
  await expect(probeId3Source(source(bytes),{onTag:async()=>{throw new Error("callback failure");}})).rejects.toThrow("callback failure");
  const controller = new AbortController();
  await expect(probeId3Source({size:bytes.length,async read(offset,length){controller.abort(new Error("cancelled read"));return bytes.slice(offset,offset+length);}},{signal:controller.signal})).rejects.toThrow("cancelled read");
});
it("matches rejection for truncated and transformed ID3 frame variations", async () => {
  for (const version of [2,3,4]) for (const flags of [0,32,64,128,192]) for (const frameFlags of [0,1,2,4,8,32,64,128]) {
    const bytes = fixture(version,flags,frame(version,version === 2 ? "TT2" : "TIT2",[3,65,0,32],frameFlags));
    let expected: ReturnType<typeof parseId3> | undefined, message: string | undefined;
    try { expected = parseId3(bytes); } catch(error) { message = (error as Error).message; }
    if (expected) expect(await probeId3Source(source(bytes))).toEqual({size:expected.size,version:expected.version,tags:expected.tags});
    else await expect(probeId3Source(source(bytes))).rejects.toThrow(message);
  }
  const valid = encodeId3({title:"value"});
  for (let length = 0; length < valid.length; length++) await expect(probeId3Source(source(valid.slice(0,length)))).rejects.toThrow();
});
it("rechecks cancellation after checkpoints and rejects short source reads", async () => {
  const bytes = encodeId3({title:"value"}), controller = new AbortController();
  await expect(probeId3Source(source(bytes),{signal:controller.signal,checkpoint:async()=>{controller.abort(new Error("checkpoint cancellation"));}})).rejects.toThrow("checkpoint cancellation");
  await expect(probeId3Source({size:bytes.length,async read(){return new Uint8Array();}})).rejects.toThrow("Truncated or invalid audio structure");
});
it("replays unsynchronized spans across cache edges and trailing FF00", async () => {
  for (const length of [16362,16363,16372,16373]) {
    const logical = frame(3,"TIT2",[0,...new Array<number>(length).fill(65),255,66,255]);
    await compare(fixture(3,128,logical.flatMap(value=>value===255?[255,0]:[value])));
  }
});
it("keeps replay cancellation and read failures observable after a successful scan", async () => {
  const bytes = encodeId3({title:"é😀".repeat(10000)}), spans: Id3TextSpan[] = [];
  await probeId3Source(source(bytes),{onTag:async span=>{spans.push(span);}});
  const controller=new AbortController(), iterator=readId3Text(source(bytes),spans[0]!,{signal:controller.signal});
  await iterator.next(); controller.abort(new Error("replay cancelled"));
  await expect(iterator.next()).rejects.toThrow("replay cancelled");
  const failed=readId3Text({size:bytes.length,async read(){throw new Error("replay read failed");}},spans[0]!);
  await expect(failed.next()).rejects.toThrow("replay read failed");
});
