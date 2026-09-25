import { describe, it, expect } from "vitest";
import { parseAudio, writeAudioMetadata } from "./index.js";
import { ascii, join, uint32 } from "./binary.js";

const be32 = (v: number) => uint32(v);
const le32 = (v: number) => uint32(v, true);
function atom(type: string, data: Uint8Array): Uint8Array {
  return join([be32(data.length + 8), ascii(type), data]);
}
function comments(): Uint8Array {
  return join([le32(4), ascii("test"), le32(1), le32(9), ascii("TITLE=One")]);
}
function mp3(): Uint8Array {
  const frame = new Uint8Array(417);
  frame.set([255, 251, 144, 0]);
  return join([frame, frame]);
}
function flac(): Uint8Array {
  const info = new Uint8Array(34),
    v = new DataView(info.buffer);
  v.setUint16(0, 4096);
  v.setUint16(2, 4096);
  v.setBigUint64(10, (44100n << 44n) | (1n << 41n) | (15n << 36n) | 44100n);
  info.set(new Uint8Array(16).fill(42), 18);
  const seek = new Uint8Array(18);
  new DataView(seek.buffer).setBigUint64(0, 22050n);
  return join([
    ascii("fLaC"),
    new Uint8Array([0, 0, 0, 34]),
    info,
    new Uint8Array([3, 0, 0, 18]),
    seek,
    new Uint8Array([132, 0, 0, comments().length]),
    comments()
  ]);
}
function page(packet: Uint8Array, sequence: number, granule: bigint, flags: number): Uint8Array {
  const header = new Uint8Array(28);
  header.set(ascii("OggS"));
  header[5] = flags;
  header[26] = 1;
  header[27] = packet.length;
  const v = new DataView(header.buffer);
  v.setBigUint64(6, granule, true);
  v.setUint32(14, 1, true);
  v.setUint32(18, sequence, true);
  const bytes = join([header, packet]);
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 24;
    for (let k = 0; k < 8; k++) crc = (crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0);
  }
  new DataView(bytes.buffer).setUint32(22, crc >>> 0, true);
  return bytes;
}
function opus(): Uint8Array {
  const head = new Uint8Array(19);
  head.set(ascii("OpusHead"));
  head[8] = 1;
  head[9] = 2;
  new DataView(head.buffer).setUint16(10, 312, true);
  return join([
    page(head, 0, 0n, 2),
    page(join([ascii("OpusTags"), comments()]), 1, 0n, 0),
    page(new Uint8Array([0]), 2, 48312n, 4)
  ]);
}
function m4a(): Uint8Array {
  const mvhd = new Uint8Array(100);
  const v = new DataView(mvhd.buffer);
  v.setUint32(12, 1000);
  v.setUint32(16, 2000);
  const mdhd = new Uint8Array(24);
  new DataView(mdhd.buffer).setUint32(12, 48000);
  new DataView(mdhd.buffer).setUint32(16, 96000);
  const sample = new Uint8Array(28);
  const s = new DataView(sample.buffer);
  s.setUint16(6, 1);
  s.setUint16(16, 2);
  s.setUint16(18, 16);
  s.setUint32(24, 48000 * 65536);
  const stsd = atom("stsd", join([new Uint8Array(4), be32(1), atom("mp4a", sample)]));
  const name = atom("©nam", atom("data", join([be32(1), be32(0), ascii("One")])));
  return join([
    atom("ftyp", join([ascii("M4A "), be32(0), ascii("isom")])),
    atom(
      "moov",
      join([
        atom("mvhd", mvhd),
        atom("trak", atom("mdia", join([atom("mdhd", mdhd), atom("minf", atom("stbl", stsd))]))),
        atom("udta", atom("meta", join([new Uint8Array(4), atom("ilst", name)])))
      ])
    ),
    atom("mdat", new Uint8Array(8))
  ]);
}

describe("container AST and metadata", () => {
  it("counts MPEG frames exactly and writes ID3 v2 without losing frames", () => {
    const data = mp3(),
      ast = parseAudio(data);
    expect(ast.streams[0]).toMatchObject({
      codec: "mp3",
      sampleRate: 44100,
      channels: 2,
      samples: 2304
    });
    expect(ast.duration).toBe(2304 / 44100);
    const written = writeAudioMetadata(data, {
      title: "Track",
      artist: "Artist",
      album: "Album",
      track: "2"
    });
    expect(parseAudio(written).tags).toMatchObject({
      title: "Track",
      artist: "Artist",
      album: "Album",
      track: "2"
    });
    expect(parseAudio(written).streams).toEqual(ast.streams);
    expect(written.subarray(written.length - data.length)).toEqual(data);
  });
  it("reads STREAMINFO, signature, seek points, Vorbis comments and writes FLAC metadata", () => {
    const data = flac(),
      ast = parseAudio(data);
    expect(ast.streams[0]).toMatchObject({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      samples: 44100
    });
    expect(ast.duration).toBe(1);
    expect(ast.tags.title).toBe("One");
    expect(ast.nodes[0]?.fields?.md5).toBe("2a".repeat(16));
    expect(ast.nodes[1]?.fields?.points).toEqual([{ sample: 22050n, offset: 0n, samples: 0 }]);
    expect(
      parseAudio(writeAudioMetadata(data, { title: "Two", artist: "New" })).tags
    ).toMatchObject({ title: "Two", artist: "New" });
  });
  it("reads Opus granule duration minus pre-skip and rewrites checksummed tags", () => {
    const data = opus(),
      ast = parseAudio(data);
    expect(ast.streams[0]).toMatchObject({
      codec: "opus",
      sampleRate: 48000,
      channels: 2,
      samples: 48000
    });
    expect(ast.tags.title).toBe("One");
    expect(ast.duration).toBe(1);
    const written = writeAudioMetadata(data, { title: "Two" });
    expect(parseAudio(written).tags.title).toBe("Two");
    expect(parseAudio(written).duration).toBe(1);
  });
  it("reads nested BMFF audio sample descriptions, duration and iTunes metadata", () => {
    const data = m4a(),
      ast = parseAudio(data);
    expect(ast.streams[0]).toMatchObject({
      codec: "aac",
      sampleRate: 48000,
      channels: 2,
      samples: 96000
    });
    expect(ast.duration).toBe(2);
    expect(ast.tags.title).toBe("One");
    const written = writeAudioMetadata(data, { title: "Two", artist: "New" });
    expect(parseAudio(written).tags).toMatchObject({ title: "Two", artist: "New" });
    expect(parseAudio(written).streams).toEqual(ast.streams);
  });
  for (const [name, fixture] of [
    ["mp3", mp3],
    ["flac", flac],
    ["ogg", opus],
    ["m4a", m4a]
  ] as const)
    it(`rejects truncated ${name}`, () => {
      const data = fixture();
      expect(() => parseAudio(data.subarray(0, data.length - 1))).toThrow();
    });
});
