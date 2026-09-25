import { it, expect } from "vitest";
import {
  parseAudio,
  encodeWav,
  decodePcm,
  writeAudioMetadata,
  extractChannels,
  remix,
  stats
} from "./index.js";
import { ascii, join, uint32 } from "./binary.js";
import { riffChunk } from "./wav.js";
import { encodeOgg, type OggPacket } from "./ogg.js";
import { encodeComments, encodePicture } from "./vorbis.js";

function riff(chunks: Uint8Array[]): Uint8Array {
  const body = join([ascii("WAVE"), ...chunks]);
  return join([ascii("RIFF"), uint32(body.length, true), body]);
}
function sync(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 21) & 127,
    (value >>> 14) & 127,
    (value >>> 7) & 127,
    value & 127
  ]);
}
function frame(version: number, rateIndex = 0, bitrateIndex = 9, mono = false): Uint8Array {
  const v = version === 1 ? 3 : version === 2 ? 2 : 0,
    rate = [44100, 48000, 32000][rateIndex]! / (version === 1 ? 1 : version === 2 ? 2 : 4);
  const bitrate =
    (version === 1
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[bitrateIndex]! * 1000;
  const bytes = new Uint8Array(Math.floor(((version === 1 ? 144 : 72) * bitrate) / rate));
  bytes.set([255, 224 | (v << 3) | 3, (bitrateIndex << 4) | (rateIndex << 2), mono ? 192 : 0]);
  return bytes;
}
function id3(version: number, id: string, payload: Uint8Array): Uint8Array {
  const size =
    version === 2
      ? new Uint8Array([payload.length >>> 16, (payload.length >>> 8) & 255, payload.length & 255])
      : version === 4
        ? sync(payload.length)
        : uint32(payload.length);
  const body = join([ascii(id), size, ...(version === 2 ? [] : [new Uint8Array(2)]), payload]);
  return join([ascii("ID3"), new Uint8Array([version, 0, 0]), sync(body.length), body]);
}
function opusHead(): Uint8Array {
  const head = new Uint8Array(19);
  head.set(ascii("OpusHead"));
  head[8] = 1;
  head[9] = 1;
  return head;
}
function vorbisPackets(serial = 1): OggPacket[] {
  const head = new Uint8Array(30);
  head.set(join([new Uint8Array([1]), ascii("vorbis")]));
  head[11] = 2;
  new DataView(head.buffer).setUint32(12, 44100, true);
  head[28] = 0xb8;
  head[29] = 1;
  return [
    head,
    join([
      new Uint8Array([3]),
      ascii("vorbis"),
      encodeComments({ title: "Vorbis" }),
      new Uint8Array([1])
    ]),
    new Uint8Array([5, ...ascii("vorbis")]),
    new Uint8Array([0])
  ].map((data, i) => ({
    data,
    serial,
    granule: i === 3 ? 44100n : 0n,
    bos: i === 0,
    eos: i === 3
  }));
}
it("reads extensible WAV valid precision, mask, Broadcast Wave and fact fields", () => {
  const fmt = new Uint8Array(40),
    v = new DataView(fmt.buffer);
  v.setUint16(0, 0xfffe, true);
  v.setUint16(2, 1, true);
  v.setUint32(4, 8000, true);
  v.setUint32(8, 32000, true);
  v.setUint16(12, 4, true);
  v.setUint16(14, 32, true);
  v.setUint16(16, 22, true);
  v.setUint16(18, 24, true);
  v.setUint32(20, 4, true);
  fmt.set([1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113], 24);
  const bext = new Uint8Array(606);
  bext.set(ascii("Broadcast"));
  new DataView(bext.buffer).setBigUint64(338, 123456n, true);
  bext.set(ascii("PCM\n"), 602);
  const data = riff([
    riffChunk("fmt ", fmt),
    riffChunk("bext", bext),
    riffChunk("fact", uint32(1, true)),
    riffChunk("data", new Uint8Array([0, 0, 0, 64]))
  ]);
  const ast = parseAudio(data);
  expect(ast.nodes[0]?.fields).toMatchObject({
    validBitsPerSample: 24,
    channelMask: 4,
    subformat: 1
  });
  expect(ast.nodes[1]?.fields).toMatchObject({
    description: "Broadcast",
    timeReference: 123456n,
    codingHistory: "PCM\n"
  });
  expect(decodePcm(data).channels[0]![0]).toBe(0.5);
  expect(
    parseAudio(writeAudioMetadata(data, { title: "New" })).nodes.find((n) => n.type === "bext")
      ?.data
  ).toEqual(bext);
});
for (const version of [2, 3, 4])
  it(`reads ID3v2.${version} title, UTF16 artist, comments and artwork`, () => {
    const title = id3(
      version,
      version === 2 ? "TT2" : "TIT2",
      join([new Uint8Array([0]), ascii("Title")])
    );
    expect(parseAudio(join([title, frame(1)])).tags.title).toBe("Title");
    const artist = id3(
      version,
      version === 2 ? "TP1" : "TPE1",
      new Uint8Array([1, 255, 254, 65, 0, 114, 0, 116, 0, 0, 0])
    );
    expect(parseAudio(join([artist, frame(1)])).tags.artist).toBe("Art");
    const picture = id3(
      version,
      version === 2 ? "PIC" : "APIC",
      join([
        new Uint8Array([0]),
        ascii(version === 2 ? "PNG" : "image/png"),
        ...(version === 2 ? [] : [new Uint8Array(1)]),
        new Uint8Array([3, 0, 1, 2, 3])
      ])
    );
    const ast = parseAudio(join([picture, frame(1)]));
    expect(ast.pictures[0]).toMatchObject({
      type: 3,
      mime: "image/png",
      description: "",
      data: new Uint8Array([1, 2, 3])
    });
    expect(parseAudio(writeAudioMetadata(ast, { title: "New" })).pictures).toEqual(ast.pictures);
    const comment = id3(
      version,
      version === 2 ? "COM" : "COMM",
      join([new Uint8Array([0]), ascii("eng"), new Uint8Array(1), ascii("Comment")])
    );
    expect(parseAudio(join([comment, frame(1)])).tags.comment).toBe("Comment");
  });
it("reads ID3v1.1 and preserves tags when upgrading to v2", () => {
  const tag = new Uint8Array(128);
  tag.set(ascii("TAGTitle"));
  tag[126] = 7;
  tag[127] = 13;
  const data = join([frame(1), tag]);
  expect(parseAudio(data).tags).toMatchObject({ title: "Title", track: "7", genre: "13" });
  expect(parseAudio(writeAudioMetadata(data, { artist: "New" })).tags).toMatchObject({
    title: "Title",
    artist: "New",
    track: "7",
    genre: "13"
  });
});
for (const version of [1, 2, 2.5])
  it(`reads MPEG-${version} Layer III timing and mono headers`, () => {
    const data = join([frame(version, 1, 8, true), frame(version, 1, 9, true)]),
      s = parseAudio(data).streams[0]!;
    expect(s.channels).toBe(1);
    expect(s.sampleRate).toBe(48000 / (version === 1 ? 1 : version === 2 ? 2 : 4));
    expect(s.samples).toBe(version === 1 ? 2304 : 1152);
    expect(s.bitrate).toBe((data.length * 8) / s.duration);
  });
for (const marker of ["Xing", "Info", "VBRI"])
  it(`reads ${marker} VBR header`, () => {
    const data = frame(1);
    data.set(ascii(marker), 36);
    const v = new DataView(data.buffer);
    if (marker === "VBRI") {
      v.setUint16(40, 1);
      v.setUint32(46, data.length);
      v.setUint32(50, 1);
    } else {
      v.setUint32(40, 3);
      v.setUint32(44, 1);
      v.setUint32(48, data.length);
    }
    expect(parseAudio(data).nodes[0]?.fields?.vbr).toMatchObject({
      type: marker,
      frames: 1,
      bytes: data.length
    });
  });
it("reads Vorbis and repaginates a comment spanning multiple Ogg pages", () => {
  const data = encodeOgg(vorbisPackets());
  expect(parseAudio(data).streams[0]).toMatchObject({
    codec: "vorbis",
    samples: 44100,
    duration: 1
  });
  const title = "x".repeat(70000);
  const written = writeAudioMetadata(data, { title });
  expect(parseAudio(written).tags.title).toBe(title);
  expect(parseAudio(written).duration).toBe(1);
});
it("distinguishes chained and multiplexed Ogg durations", () => {
  const a = vorbisPackets(1),
    b = vorbisPackets(2);
  expect(parseAudio(encodeOgg([...a, ...b])).duration).toBe(2);
  expect(
    parseAudio(encodeOgg([a[0]!, b[0]!, a[1]!, b[1]!, a[2]!, b[2]!, a[3]!, b[3]!])).duration
  ).toBe(1);
});
it("reads and writes Ogg picture comments", () => {
  const picture = {
    type: 3,
    mime: "image/png",
    description: "Cover",
    width: 1,
    height: 1,
    depth: 24,
    colors: 0,
    data: new Uint8Array([1, 2, 3])
  };
  const base64 = btoa(String.fromCharCode(...encodePicture(picture)));
  const packets = [
    opusHead(),
    join([ascii("OpusTags"), encodeComments({ METADATA_BLOCK_PICTURE: base64 })]),
    new Uint8Array([0])
  ].map((data, i) => ({
    data,
    serial: 1,
    granule: i === 2 ? 48000n : 0n,
    bos: i === 0,
    eos: i === 2
  }));
  const bytes = encodeOgg(packets);
  expect(parseAudio(bytes).pictures).toEqual([picture]);
  expect(
    parseAudio(
      writeAudioMetadata(
        bytes,
        { title: "Art" },
        { pictures: [{ ...picture, description: "Updated" }] }
      )
    ).pictures[0]?.description
  ).toBe("Updated");
});
it("reports silence and extracts/mixes channels without mutation", () => {
  const pcm = {
    sampleRate: 8000,
    channels: [Float64Array.from([0.2, 0.4]), Float64Array.from([-0.2, -0.4])]
  };
  expect(Array.from(remix(pcm, 1).channels[0]!)).toEqual([0, 0]);
  expect(stats(remix(pcm, 1)).rmsDbfs).toBe(-Infinity);
  expect(extractChannels(pcm, [1]).channels[0]).toEqual(pcm.channels[1]);
  expect(() => encodeWav({ ...pcm, channels: [new Float64Array([NaN])] })).toThrow();
});
it("uses Xing audio frame count and encoder delay/padding for exact gapless duration", () => {
  const header = frame(1),
    audio = frame(1);
  header.set(ascii("Xing"), 36);
  const v = new DataView(header.buffer);
  v.setUint32(40, 1);
  v.setUint32(44, 2);
  header.set(ascii("Lavc63.1."), 48);
  const packed = (576 << 12) | 576;
  header[69] = packed >>> 16;
  header[70] = (packed >>> 8) & 255;
  header[71] = packed & 255;
  const ast = parseAudio(join([header, audio, audio]));
  expect(ast.streams[0]?.samples).toBe(1152);
  expect(ast.duration).toBe(1152 / 44100);
  expect(ast.nodes[0]?.fields).toMatchObject({ encoderDelay: 576, encoderPadding: 576 });
});
it("keeps Ogg audio packets sharing a granule on the same page during metadata rewrite", () => {
  const packets = [
    opusHead(),
    join([ascii("OpusTags"), encodeComments({ title: "Old" })]),
    new Uint8Array([0]),
    new Uint8Array([0])
  ].map((data, i) => ({
    data,
    serial: 1,
    granule: i === 2 ? 0xffffffffffffffffn : i === 3 ? 1920n : 0n,
    bos: i === 0,
    eos: i === 3
  }));
  const bytes = encodeOgg(packets);
  const written = writeAudioMetadata(bytes, { title: "New" });
  const ast = parseAudio(written);
  expect(ast.nodes.filter((n) => n.fields?.granule === 0xffffffffffffffffn)).toHaveLength(0);
  expect(ast.nodes.at(-1)?.fields?.lacing).toHaveLength(2);
});
it("reads FLAC pictures and preserves seek tables/application blocks during tag rewrite", () => {
  const info = new Uint8Array(34);
  new DataView(info.buffer).setBigUint64(10, (8000n << 44n) | (15n << 36n) | 8000n);
  const picture = {
    type: 3,
    mime: "image/jpeg",
    description: "Cover",
    width: 2,
    height: 1,
    depth: 24,
    colors: 0,
    data: new Uint8Array([255, 216, 255, 217])
  };
  function block(type: number, data: Uint8Array): Uint8Array {
    return join([
      new Uint8Array([type, data.length >>> 16, (data.length >>> 8) & 255, data.length & 255]),
      data
    ]);
  }
  const application = new Uint8Array([65, 66, 67, 68, 1, 2, 3]);
  const data = join([
    ascii("fLaC"),
    block(0, info),
    block(2, application),
    block(134, encodePicture(picture))
  ]);
  const ast = parseAudio(data);
  expect(ast.pictures).toEqual([picture]);
  const written = parseAudio(writeAudioMetadata(data, { title: "Title" }));
  expect(written.pictures).toEqual([picture]);
  expect(written.nodes.find((n) => n.type === "APPLICATION")?.data).toEqual(application);
});
it("maps ID3v2.2 JPG artwork to the JPEG MIME type", () => {
  const picture = id3(
    2,
    "PIC",
    join([new Uint8Array([0]), ascii("JPG"), new Uint8Array([3, 0, 1])])
  );
  expect(parseAudio(join([picture, frame(1)])).pictures[0]?.mime).toBe("image/jpeg");
});
it("refuses to silently discard encrypted/compressed known ID3 frames on rewrite", () => {
  const tag = id3(3, "TIT2", new Uint8Array([0, 65]));
  tag[19] = 64;
  expect(() => writeAudioMetadata(join([tag, frame(1)]), { artist: "Artist" })).toThrow();
});
it("removes ID3 unsynchronization and respects extended-header/frame bounds", () => {
  const tag = id3(3, "TIT2", new Uint8Array([0, 65, 255, 225]));
  tag[5] = 128;
  const escaped = join([tag.subarray(0, 23), new Uint8Array([0]), tag.subarray(23)]);
  escaped.set(sync(escaped.length - 10), 6);
  expect(parseAudio(join([escaped, frame(1)])).tags.title).toBe("Aÿá");
  const bad = id3(4, "TIT2", new Uint8Array([3, 65]));
  bad[14] = 128;
  expect(() => parseAudio(join([bad, frame(1)]))).toThrow();
});
