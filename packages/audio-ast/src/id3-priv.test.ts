import { expect, it } from "vitest";
import { encodeId3, parseId3 } from "./id3.js";
import { probeId3Source, readId3Text, type Id3TextSpan } from "./id3-source.js";

function privateFrame(owner: string, data: Uint8Array) {
  const payload = Uint8Array.from([...Array.from(owner, char => char.charCodeAt(0)), 0, ...data]);
  return { type: "PRIV", offset: 0, size: payload.length, data: payload };
}
const binary = Uint8Array.from([0, 9, 10, 13, 31, 32, 33, 34, 65, 90, 91, 92, 93, 126, 127, 128, 160, 255, 32]);
const escaped = '\\x00\\x09\\x0a\\x0d\\x1f !"AZ[\\x5c]~\\x7f\\x80\\xa0\\xff ';
for (const version of [3, 4] as const) {
  it(`preserves ID3v2.${version} PRIV owners, printable/binary bytes and trailing spaces`, async () => {
    const owner = " com.example.é\u0080 ", frames = [privateFrame(owner, binary), privateFrame("empty", new Uint8Array()),
      privateFrame("spaces", new Uint8Array([32, 65, 32, 32]))];
    const bytes = encodeId3({ title: "Recording", custom: "TXXX" }, frames, [], version);
    const expected = { title: "Recording", custom: "TXXX", ["id3v2_priv." + owner]: escaped,
      "id3v2_priv.empty": "", "id3v2_priv.spaces": " A  " };
    expect(parseId3(bytes).tags).toEqual(expected);
    const source = { size: bytes.length, async read(offset: number, length: number) {
      expect(length).toBeLessThanOrEqual(16384);
      return bytes.slice(offset, offset + length);
    } };
    expect((await probeId3Source(source)).tags).toEqual(expected);
    const spans: Id3TextSpan[] = [];
    await probeId3Source(source, { onTag: async span => { spans.push(span); } });
    const tags: Record<string, string> = {};
    for (const span of spans) {
      let value = "";
      for await (const part of readId3Text(source, span)) value += part;
      tags[span.key] = value;
    }
    expect(tags).toEqual(expected);
  });
}
it("retains private frames without duplicating them as user text during metadata rewrites", () => {
  const parsed = parseId3(encodeId3({}, [privateFrame("com.example.take", binary)]));
  const rewritten = parseId3(encodeId3({ ...parsed.tags, title: "Updated" }, parsed.nodes));
  expect(rewritten.tags).toEqual({ ...parsed.tags, title: "Updated" });
  expect(rewritten.nodes.map(node => node.type)).toEqual(["PRIV", "TIT2"]);
  expect(rewritten.nodes[0]!.data).toEqual(parsed.nodes[0]!.data);
});
it("replays long private payloads with bounded reads and cancellation", async () => {
  const bytes = encodeId3({}, [privateFrame("large", new Uint8Array(40000).fill(255))]);
  const source = { size: bytes.length, async read(offset: number, length: number) {
    expect(length).toBeLessThanOrEqual(16384);
    return bytes.slice(offset, offset + length);
  } };
  const spans: Id3TextSpan[] = [];
  await probeId3Source(source, { onTag: async span => { spans.push(span); } });
  expect(spans).toHaveLength(1);
  let value = "";
  for await (const part of readId3Text(source, spans[0]!)) value += part;
  expect(value).toBe("\\xff".repeat(40000));
  const controller = new AbortController();
  const replay = readId3Text(source, spans[0]!, { signal: controller.signal });
  await replay.next(); controller.abort(new Error("cancelled replay"));
  await expect(replay.next()).rejects.toThrow("cancelled replay");
});
for (const version of [3, 4] as const) {
  it(`decodes ID3v2.${version} unsynchronized private bytes after grouping prefixes`, async () => {
    const original = encodeId3({}, [privateFrame("owner", new Uint8Array([255, 0, 92, 255, 224, 32]))], [], version);
    const physical = Uint8Array.from(Array.from(original.subarray(20)).flatMap(byte => byte === 255 ? [255, 0] : [byte]));
    const bytes = new Uint8Array(21 + physical.length);
    bytes.set(original.subarray(0, 20)); bytes[20] = 7; bytes.set(physical, 21);
    bytes[5] = version === 3 ? 128 : 0;
    bytes[19] = version === 3 ? 32 : 66;
    const size = bytes.length - 10;
    bytes.set([size >>> 21 & 127, size >>> 14 & 127, size >>> 7 & 127, size & 127], 6);
    new DataView(bytes.buffer).setUint32(14, version === 3 ? original.length - 19 : bytes.length - 20);
    const expected = { "id3v2_priv.owner": "\\xff\\x00\\x5c\\xff\\xe0 " };
    expect(parseId3(bytes).tags).toEqual(expected);
    expect((await probeId3Source({ size: bytes.length, async read(offset, length) {
      return bytes.slice(offset, offset + length);
    } })).tags).toEqual(expected);
  });
}
