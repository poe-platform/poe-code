import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes, escapeRbsp, MediaBudgetTracker, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Four libx264 frames, with IDR frames at 0 and 2. The combined fixture has
// UUID 12345678-1234-5678-9abc-def012345678 + take-42 and orientation in one SEI.
const clean = readFileSync(new URL("./fixtures/h264-orientation-clean.mp4", import.meta.url));
const combined = readFileSync(new URL("./fixtures/h264-orientation-combined.mp4", import.meta.url));
const userData = "06051812345678123456789abcdef01234567874616b652d34320080";

function units(data: Uint8Array): Buffer[] {
  const result: Buffer[] = [];
  for (let offset = 0; offset < data.length;) {
    const size = new DataView(data.buffer, data.byteOffset + offset).getUint32(0);
    result.push(Buffer.from(data.subarray(offset + 4, offset + 4 + size)));
    offset += 4 + size;
  }
  return result;
}

function packet(...nals: Uint8Array[]): Uint8Array {
  return concatBytes(nals.flatMap(nal => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(nal.length);
    return [length, nal];
  }));
}

// SEI bytes captured with native FFmpeg 7.0.2, including payload alignment.
for (const sync of [false, true]) {
  for (const [input, option, expected] of [
    [clean, "display_orientation=insert:rotate=90", "062f0308000980"],
    [clean, "display_orientation=insert:flip=horizontal", "062f0340000980"],
    [clean, "display_orientation=insert:flip=vertical", "062f0320000980"],
    [clean, "display_orientation=insert:rotate=-90:flip=horizontal+vertical", "062f0378000980"],
    [combined, "display_orientation=remove", userData],
    [clean, "display_orientation=remove", ""],
    [clean, "display_orientation=insert", ""],
    [combined, "display_orientation=pass:rotate=90", userData.slice(0, -2) + "2f0308000980"]
  ] as const) {
    it(`copies H.264 with ${option} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": input });
      const args = ["-v", "error", "-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", "-bsf:v", `h264_metadata=${option}`, "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const before = parseMp4(input).tracks[0]!;
      const after = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
      assert.equal(after.samples.length, before.samples.length);
      assert.deepEqual(after.codecDescriptions[0]!.avcC, before.codecDescriptions[0]!.avcC);
      for (const [i, sample] of after.samples.entries()) {
        const nals = units(sample.data);
        const original = before.samples[i]!;
        assert.deepEqual(nals.filter(nal => (nal[0]! & 31) !== 6), units(original.data).filter(nal => (nal[0]! & 31) !== 6));
        assert.deepEqual(nals.filter(nal => (nal[0]! & 31) === 6).map(nal => nal.toString("hex")),
          original.isKeyframe && expected ? [expected] : []);
        assert.equal(sample.duration, original.duration);
        assert.equal(sample.pts, original.pts);
        assert.equal(sample.dts, original.dts);
      }
    });
  }
}

it("inserts at the first packet and in-band SPS, and replaces orientation in filter order", () => {
  const doc = parseMp4(clean);
  const track = doc.tracks[0]!;
  const samples = track.samples.map((sample, i) => ({ ...sample, isKeyframe: false,
    data: i === 1 ? concatBytes([packet(track.codecDescriptions[0]!.avcC!.sps[0]!), sample.data]) : sample.data }));
  const chain = "h264_metadata=display_orientation=insert:rotate=90,h264_metadata=display_orientation=insert:flip=horizontal";
  const output = filterBitstream([{ ...track, samples }], chain, new MediaBudgetTracker())[0]!;
  assert.deepEqual(output.samples.map(sample => units(sample.data).filter(nal => (nal[0]! & 31) === 6).map(nal => nal.toString("hex"))),
    [["062f0340000980"], ["062f0340000980"], [], []]);
  const restored = filterBitstream([output], "h264_metadata=display_orientation=remove", new MediaBudgetTracker())[0]!;
  assert.deepEqual(restored.samples.map(sample => Buffer.from(sample.data)), samples.map(sample => Buffer.from(sample.data)));
});

it("preserves extended SEI types, sizes and escaped payloads around multiple orientation messages", () => {
  const track = parseMp4(clean).tracks[0]!;
  const orientation = Buffer.from("2f03080009", "hex");
  const payload = Buffer.alloc(260); // requires emulation-prevention bytes
  const other = concatBytes([Uint8Array.of(255, 45, 255, 5), payload]);
  const sei = escapeRbsp(concatBytes([Uint8Array.of(6), orientation, other, orientation, Uint8Array.of(128)]));
  const expected = escapeRbsp(concatBytes([Uint8Array.of(6), other, Uint8Array.of(128)]));
  const samples = [{ ...track.samples[0]!, data: concatBytes([packet(sei), track.samples[0]!.data]) }];
  const output = filterBitstream([{ ...track, samples }], "h264_metadata=display_orientation=remove", new MediaBudgetTracker())[0]!;
  assert.deepEqual(output.samples[0]!.data, concatBytes([packet(expected), track.samples[0]!.data]));
});

for (const option of ["display_orientation=bogus", "rotate=361", "rotate=-361", "rotate=Infinity", "rotate=garbage", "flip=diagonal", "flip=4"]) {
  it(`rejects invalid orientation option ${option}`, () => {
    assert.throws(() => filterBitstream([], `h264_metadata=${option}`, new MediaBudgetTracker()), /bitstream filter option/);
  });
}

it("rejects truncated SEI payloads without overwriting the destination", () => {
  const doc = parseMp4(clean);
  const track = doc.tracks[0]!;
  const input = serializeMp4({ ...doc, tracks: [{ ...track, samples: [{ ...track.samples[0]!, data: packet(Uint8Array.of(6, 47, 8, 0, 128)) }] }] });
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input), "/out.mp4": "EXISTING" });
  assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.mp4", "-c", "copy", "-bsf:v", "h264_metadata=display_orientation=remove", "/out.mp4"], undefined,
    path => volume.readFileSync(path) as Buffer, (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
  assert.equal(volume.readFileSync("/out.mp4", "utf8"), "EXISTING");
});

it("places first-packet orientation before a non-IDR slice", () => {
  const track = parseMp4(clean).tracks[0]!;
  const output = filterBitstream([{ ...track, samples: [track.samples[1]!] }],
    "h264_metadata=display_orientation=insert:rotate=90", new MediaBudgetTracker())[0]!;
  assert.deepEqual(units(output.samples[0]!.data).map(nal => nal[0]! & 31), [6, 1]);
});
