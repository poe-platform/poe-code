import { expect, it } from "vitest";
import { probeAudio, probeFlacSource } from "./index.js";
import { encodeComments, encodePicture } from "./vorbis.js";
import { join } from "./binary.js";

function flac(blocks: { type: number; bytes: Uint8Array }[] = [], frames = 0) {
  const info = new Uint8Array(34); new DataView(info.buffer).setBigUint64(10, (48000n << 44n) | (1n << 41n) | (23n << 36n) | 96000n);
  const all = [{ type: 0, bytes: info }, ...blocks];
  return join([new TextEncoder().encode("fLaC"), ...all.flatMap((block, i) => [Uint8Array.of(block.type | (i === all.length - 1 ? 128 : 0), block.bytes.length >>> 16, block.bytes.length >>> 8 & 255, block.bytes.length & 255), block.bytes]), new Uint8Array(frames)]);
}
function source(bytes: Uint8Array) { return { size: bytes.length, async read(offset: number, length: number) { expect(length).toBeLessThanOrEqual(16384); return bytes.slice(offset, offset + length); } }; }
it("matches strict FLAC tags, timing and block replacement semantics", async () => {
  const bytes = flac([{ type: 4, bytes: encodeComments({ title: "first\nsecond", ARTIST: "artist", "12": "numeric" }) }, { type: 4, bytes: encodeComments({ title: "replacement", COMMENT: "note" }) }], 1024);
  expect(await probeFlacSource(source(bytes))).toEqual(probeAudio(bytes));
});
it("reports comment spans without reading vendor, comment, picture or frame payloads", async () => {
  const comments = encodeComments({ title: "x".repeat(200000) }, "v".repeat(200000));
  const picture = encodePicture({ type: 3, mime: "image/jpeg", description: "d".repeat(200000), data: new Uint8Array(200000) });
  const bytes = flac([{ type: 4, bytes: comments }, { type: 6, bytes: picture }, { type: 3, bytes: new Uint8Array(180000) }], 1000000);
  const spans: { block: number; offset: number; length: number }[] = []; let total = 0;
  const result = await probeFlacSource({ size: bytes.length, async read(offset, length) { total += length; expect(length).toBeLessThanOrEqual(34); return bytes.slice(offset, offset + length); } }, { async onComment(span) { spans.push(span); } });
  expect(total).toBeLessThan(200); expect(result.tags).toEqual({}); expect(result.streams[0]).toMatchObject({ sampleRate: 48000, channels: 2, samples: 96000 });
  expect(spans).toHaveLength(1); expect(new TextDecoder().decode(bytes.subarray(spans[0]!.offset, spans[0]!.offset + spans[0]!.length))).toBe("TITLE=" + "x".repeat(200000));
});
for (const block of [
  { type: 0, bytes: new Uint8Array(34) }, { type: 3, bytes: new Uint8Array(17) }, { type: 127, bytes: new Uint8Array() },
  { type: 4, bytes: Uint8Array.of(255, 255, 255, 255) }, { type: 4, bytes: Uint8Array.of(0, 0, 0, 0, 255, 255, 255, 255) },
  { type: 4, bytes: join([encodeComments({ title: "valid" }), Uint8Array.of(0)]) },
  { type: 6, bytes: new Uint8Array(10) }, { type: 6, bytes: join([encodePicture({ type: 3, mime: "", description: "", data: new Uint8Array() }), Uint8Array.of(0)]) }
]) it(`preserves malformed block rejection for ${block.type}/${block.bytes.length}`, async () => {
  const bytes = flac([block]); let message = ""; try { probeAudio(bytes); } catch (error) { message = (error as Error).message; }
  expect(message).not.toBe(""); await expect(probeFlacSource(source(bytes), { async onComment() {} })).rejects.toThrow(message);
});
it("preserves truncated block rejection", async () => {
  const bytes = flac([{ type: 1, bytes: new Uint8Array(30) }]).slice(0, 50);
  await expect(probeFlacSource(source(bytes))).rejects.toThrow("Truncated or invalid audio structure");
});
it("propagates source and callback failures and post-read cancellation", async () => {
  const bytes = flac([{ type: 4, bytes: encodeComments({ title: "value" }) }]);
  await expect(probeFlacSource({ size: bytes.length, async read() { throw new Error("read failed"); } })).rejects.toThrow("read failed");
  await expect(probeFlacSource(source(bytes), { async onComment() { throw new Error("index failed"); } })).rejects.toThrow("index failed");
  const controller = new AbortController();
  await expect(probeFlacSource({ size: bytes.length, async read(offset, length) { controller.abort(new Error("cancelled")); return bytes.slice(offset, offset + length); } }, { signal: controller.signal })).rejects.toThrow("cancelled");
});
it("matches resident rejection across truncated and mutated metadata", async () => {
  const valid = flac([{ type: 4, bytes: encodeComments({ title: "é\nsecond", "42": "number" }) }, { type: 6, bytes: encodePicture({ type: 3, mime: "image/jpeg", description: "cover", data: Uint8Array.of(1, 2, 3) }) }]);
  const candidates = Array.from({ length: valid.length - 4 }, (_, i) => valid.slice(0, i + 4));
  for (let i = 4; i < valid.length; i++) { const changed = valid.slice(); changed[i] = 255; candidates.push(changed); }
  for (const bytes of candidates) {
    let expected: unknown, failure: string | undefined;
    try { expected = probeAudio(bytes); } catch (error) { failure = (error as Error).message; }
    if (failure) await expect(probeFlacSource(source(bytes))).rejects.toThrow(failure);
    else expect(await probeFlacSource(source(bytes))).toEqual(expected);
  }
});
it("retains UTF-8 decoder state for split convenience values and comment block identity for spans", async () => {
  const title = "x".repeat(16377) + "🙂É".repeat(10000);
  const bytes = flac([{ type: 4, bytes: encodeComments({ title }) }, { type: 4, bytes: encodeComments({ artist: "next" }) }]);
  expect(await probeFlacSource(source(bytes))).toEqual(probeAudio(bytes));
  const blocks: number[] = [];
  await probeFlacSource(source(bytes), { async onComment(span) { blocks.push(span.block); } });
  expect(blocks).toHaveLength(2); expect(blocks[1]).toBeGreaterThan(blocks[0]!);
});
it("rejects short source reads and checks cancellation after callbacks", async () => {
  const bytes = flac([{ type: 4, bytes: encodeComments({ title: "value" }) }]);
  await expect(probeFlacSource({ size: bytes.length, async read() { return new Uint8Array(0); } })).rejects.toThrow("Truncated or invalid audio structure");
  const controller = new AbortController();
  await expect(probeFlacSource(source(bytes), { signal: controller.signal, async onComment() { controller.abort(new Error("cancelled callback")); } })).rejects.toThrow("cancelled callback");
});
