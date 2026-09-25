import { it, expect } from "vitest";
import { parseAudio, writeAudioMetadata } from "./index.js";
import { ascii, join, uint32 } from "./binary.js";
function atom(type: string, data: Uint8Array, wide = false): Uint8Array {
  if (!wide) return join([uint32(data.length + 8), ascii(type), data]);
  const size = new Uint8Array(8);
  new DataView(size.buffer).setBigUint64(0, BigInt(data.length + 16));
  return join([uint32(1), ascii(type), size, data]);
}
function fixture(codec = "mp4a", before = true, wide = false, co64 = false): Uint8Array {
  const ftyp = atom("ftyp", join([ascii("M4A "), uint32(0), ascii("isom")]));
  const mvhd = new Uint8Array(100),
    m = new DataView(mvhd.buffer);
  m.setUint32(12, 1000);
  m.setUint32(16, 1000);
  const mdhd = new Uint8Array(24),
    d = new DataView(mdhd.buffer);
  d.setUint32(12, 48000);
  d.setUint32(16, 49024);
  const sample = new Uint8Array(28),
    s = new DataView(sample.buffer);
  s.setUint16(6, 1);
  s.setUint16(16, 2);
  s.setUint16(18, 16);
  s.setUint32(24, 48000 * 65536);
  let config = new Uint8Array(0);
  if (codec === "alac") {
    const data = new Uint8Array(28);
    data[9] = 24;
    data[13] = 2;
    new DataView(data.buffer).setUint32(24, 48000);
    config = atom("alac", data);
  }
  if (codec === "Opus") {
    const data = new Uint8Array(11);
    data[1] = 2;
    new DataView(data.buffer).setUint16(2, 312);
    new DataView(data.buffer).setUint32(4, 48000);
    config = atom("dOps", data);
  }
  const stsd = atom(
    "stsd",
    join([new Uint8Array(4), uint32(1), atom(codec, join([sample, config]))])
  );
  const offset = new Uint8Array(co64 ? 16 : 12);
  new DataView(offset.buffer).setUint32(4, 1);
  const elst = new Uint8Array(20),
    e = new DataView(elst.buffer);
  e.setUint32(4, 1);
  e.setUint32(8, 1000);
  e.setInt32(12, 1024);
  e.setUint16(16, 1);
  const mdat = atom("mdat", new Uint8Array([11, 22, 33, 44]));
  function moov(): Uint8Array {
    return atom(
      "moov",
      join([
        atom("mvhd", mvhd),
        atom(
          "trak",
          join([
            atom("edts", atom("elst", elst)),
            atom(
              "mdia",
              join([
                atom("mdhd", mdhd),
                atom("minf", atom("stbl", join([stsd, atom(co64 ? "co64" : "stco", offset)])))
              ])
            )
          ])
        )
      ]),
      wide
    );
  }
  const chunk = ftyp.length + (before ? moov().length : 0) + 8;
  if (co64) new DataView(offset.buffer).setBigUint64(8, BigInt(chunk));
  else new DataView(offset.buffer).setUint32(8, chunk);
  return join([ftyp, ...(before ? [moov(), mdat] : [mdat, moov()])]);
}
function all(
  nodes: ReturnType<typeof parseAudio>["nodes"]
): ReturnType<typeof parseAudio>["nodes"] {
  return nodes.flatMap((n) => [n, ...all(n.children ?? [])]);
}
for (const codec of ["mp4a", "alac", "Opus"])
  it(`reads ${codec} sample description and presentation edits`, () => {
    const bytes = fixture(codec),
      ast = parseAudio(bytes),
      sample = all(ast.nodes).find((n) => n.type === codec)!;
    expect(ast.streams[0]).toMatchObject({
      codec: codec === "mp4a" ? "aac" : codec.toLowerCase(),
      sampleRate: 48000,
      channels: 2,
      samples: 48000,
      duration: 1
    });
    expect(bytes.subarray(sample.offset + 4, sample.offset + 8)).toEqual(ascii(codec));
    expect(ast.streams[0]?.bitsPerSample).toBe(codec === "alac" ? 24 : 16);
  });
for (const before of [true, false])
  for (const co64 of [true, false])
    it(`keeps ${co64 ? "co64" : "stco"} audio offsets valid with moov ${before ? "before" : "after"} mdat`, () => {
      const original = fixture("mp4a", before, true, co64),
        written = writeAudioMetadata(original, { title: "A longer title", track: "3/10" }),
        ast = parseAudio(written);
      const node = all(ast.nodes).find((n) => n.type === (co64 ? "co64" : "stco"))!,
        v = new DataView(node.data.buffer, node.data.byteOffset, node.data.length),
        offset = co64 ? Number(v.getBigUint64(8)) : v.getUint32(8);
      expect(written.subarray(offset, offset + 4)).toEqual(new Uint8Array([11, 22, 33, 44]));
      expect(ast.tags).toMatchObject({ title: "A longer title", track: "3/10" });
    });
it("writes and reads iTunes cover art", () => {
  const p = { type: 3, mime: "image/png", description: "", data: new Uint8Array([1, 2, 3]) };
  expect(
    parseAudio(writeAudioMetadata(fixture(), { album: "Album" }, { pictures: [p] })).pictures
  ).toEqual([p]);
});
it("preserves freeform iTunes atoms when editing normalized tags", () => {
  const original = fixture(),
    ast = parseAudio(original),
    moov = ast.nodes.find((n) => n.type === "moov")!;
  const free = atom(
    "----",
    join([
      atom("mean", join([new Uint8Array(4), ascii("com.apple.iTunes")])),
      atom("name", join([new Uint8Array(4), ascii("CUSTOM")])),
      atom("data", join([uint32(1), uint32(0), ascii("Value")]))
    ])
  );
  const extra = atom("udta", atom("meta", join([new Uint8Array(4), atom("ilst", free)])));
  const input = join([
    original.subarray(0, moov.offset),
    atom("moov", join([moov.data, extra])),
    original.subarray(moov.offset + moov.size)
  ]);
  const output = writeAudioMetadata(input, { title: "New" });
  const retained = all(parseAudio(output).nodes).find((n) => n.type === "----")!;
  expect(output.subarray(retained.offset, retained.offset + retained.size)).toEqual(free);
});
