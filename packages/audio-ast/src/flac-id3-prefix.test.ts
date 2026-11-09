import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseAudio, probeFlacSource, writeAudioMetadata, encodeId3, id3HeaderSize, flacFormatTags } from "./index.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/id3-prefix-${name}.flac`, import.meta.url)));
for (const name of ["v3", "v4", "id3only"]) {
  it(`parses and rewrites ID3-prefixed ${name} FLAC without losing frames or metadata`, async () => {
    const bytes = fixture(name), audio = parseAudio(bytes);
    const expected = name === "id3only" ? { title: "Field recording", artist: "Ada" } : { encoder: "Lavf61.1.100" };
    expect(audio.format).toBe("flac");
    expect(audio.tags).toEqual(expected);
    expect(flacFormatTags(audio.nodes)).toEqual(expected);
    expect(audio.streams[0]?.samples).toBe(1200);
    const frames = audio.nodes.find(node => node.type === "FRAMES")!;
    expect(frames.offset).toBe(name === "id3only" ? 212 : 260);
    const source = await probeFlacSource({ size: bytes.length, async read(offset, length) {
      expect(length).toBeLessThanOrEqual(16384);
      return bytes.subarray(offset, offset + length);
    } });
    expect(source.tags).toEqual(expected);
    expect(source.streams).toEqual(audio.streams);
    const rewritten = writeAudioMetadata(bytes, { album: "Archive" });
    expect(new TextDecoder().decode(rewritten.subarray(0, 4))).toBe("fLaC");
    expect(parseAudio(rewritten).tags).toEqual({ ...expected, album: "Archive" });
    expect(parseAudio(rewritten).nodes.find(node => node.type === "FRAMES")?.data).toEqual(frames.data);
  });
}
it("includes ID3v2.4 footers in FLAC detection and offsets", () => {
  const tag = encodeId3({ title: "Footer" });
  tag[5] = 16;
  const footer = tag.slice(0, 10); footer.set(new TextEncoder().encode("3DI"));
  const input = Uint8Array.from([...tag, ...footer, ...fixture("bare")]);
  expect(id3HeaderSize(input)).toBe(tag.length + 10);
  expect(parseAudio(input).tags).toEqual({ title: "Footer" });
  expect(parseAudio(input).nodes.find(node => node.type === "FRAMES")?.offset).toBe(tag.length + 52);
});
it("rejects truncated and invalid ID3 tag lengths", () => {
  const input = fixture("v3");
  expect(() => parseAudio(input.subarray(0, 169))).toThrow();
  const invalid = Uint8Array.from(input); invalid[6] = 128;
  expect(() => parseAudio(invalid)).toThrow("Invalid ID3 synchsafe size");
});
