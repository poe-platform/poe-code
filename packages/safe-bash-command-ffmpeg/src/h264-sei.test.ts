import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, concatBytes, parseMp4, unescapeRbsp } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/h264-sei-input.mp4", import.meta.url));
// Native FFmpeg 7.0.2: two IDR frames separated by non-IDR frames.
const native = readFileSync(new URL("./fixtures/h264-sei-native.mp4", import.meta.url));
const insert = "h264_metadata=sei_user_data=12345678-1234-5678-9abc-def012345678+take-42";

for (const sync of [false, true]) {
  for (const filter of ["null", insert, `${insert},filter_units=remove_types=6`]) {
    it(`matches native H.264 user-data packets with ${filter} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": input });
      const args = ["-v", "error", "-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", "-bsf:v", filter, "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
      const expected = parseMp4(filter === insert ? native : input).tracks[0]!;
      assert.deepEqual(output.samples.map(sample => Buffer.from(sample.data)), expected.samples.map(sample => Buffer.from(sample.data)));
      assert.deepEqual(output.samples.map(sample => [sample.isKeyframe, sample.duration, sample.pts, sample.dts]),
        expected.samples.map(sample => [sample.isKeyframe, sample.duration, sample.pts, sample.dts]));
    });
  }
}

it("appends another message to existing SEI without losing the first UUID or text", () => {
  const track = parseMp4(native).tracks[0]!;
  const output = filterBitstream([track], insert, new MediaBudgetTracker())[0]!;
  const message = Buffer.from("051812345678123456789abcdef01234567874616b652d343200", "hex");
  const expected = Buffer.concat([Buffer.from([6]), message, message, Buffer.from([128])]);
  for (const [i, sample] of output.samples.entries()) {
    if (!sample.isKeyframe) assert.deepEqual(Buffer.from(sample.data), Buffer.from(track.samples[i]!.data));
    else assert.deepEqual(Buffer.from(sample.data.subarray(-expected.length)), expected);
  }
});

it("escapes zero UUID bytes and writes extended sizes for UTF-8 user data", () => {
  const track = parseMp4(input).tracks[0]!;
  const text = "é".repeat(250) + "=take+42";
  const filter = `h264_metadata=sei_user_data=00000000000000000000000000000000+${text}`;
  const output = filterBitstream([track], filter, new MediaBudgetTracker())[0]!;
  const data = output.samples[0]!.data.subarray(track.samples[0]!.data.length);
  assert.equal(new DataView(data.buffer, data.byteOffset).getUint32(0), data.length - 4);
  assert.ok(Buffer.from(data).includes(Buffer.from([0, 0, 3, 0])));
  assert.deepEqual(Buffer.from(unescapeRbsp(data.subarray(4))), Buffer.concat([
    Buffer.from([6, 5, 255, 255, 15]), Buffer.alloc(16), Buffer.from(text), Buffer.from([0, 128])
  ]));
});

it("inserts at the first packet and SPS seek points even without keyframe flags", () => {
  const track = parseMp4(input).tracks[0]!;
  const sps = track.codecDescriptions[0]!.avcC!.sps[0]!;
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(sps.length);
  const samples = track.samples.map((sample, i) => ({ ...sample, isKeyframe: false,
    data: i === 2 ? concatBytes([prefix, sps, sample.data]) : sample.data }));
  const output = filterBitstream([{ ...track, samples }], insert, new MediaBudgetTracker())[0]!;
  assert.deepEqual(output.samples.map((sample, i) => sample.data.length - samples[i]!.data.length), [32, 0, 32, 0]);
});

for (const value of ["bad+text", "12345678123456789abcdef01234567g+text", "12345678123456789abcdef012345678", "12345678123456789abcdef0123456789+text"]) {
  it(`rejects malformed UUID user data: ${value}`, () => {
    assert.throws(() => filterBitstream([], `h264_metadata=sei_user_data=${value}`, new MediaBudgetTracker()), /Invalid.*user data/);
  });
}

it("bounds inserted SEI output before allocating the payload", () => {
  assert.throws(() => filterBitstream([], insert, new MediaBudgetTracker({ maxOutputBytes: 10 })), /maxOutputBytes/);
});

for (const lengthSize of [1, 2, 4]) {
  it(`uses ${lengthSize}-byte NAL lengths and permits empty text`, () => {
    const track = parseMp4(input).tracks[0]!;
    const description = track.codecDescriptions[0]!;
    const sample = track.samples[3]!;
    const picture = sample.data.subarray(4);
    const prefix = new Uint8Array(lengthSize);
    prefix[lengthSize - 1] = picture.length;
    const source = { ...track,
      codecDescriptions: [{ ...description, avcC: { ...description.avcC!, lengthSizeMinusOne: lengthSize - 1 } }],
      samples: [{ ...sample, data: concatBytes([prefix, picture]) }] };
    const output = filterBitstream([source], "h264_metadata=sei_user_data=12345678123456789ABCDEF012345678+", new MediaBudgetTracker())[0]!;
    const sei = Buffer.from("06051112345678123456789abcdef0123456780080", "hex");
    const seiPrefix = new Uint8Array(lengthSize);
    seiPrefix[lengthSize - 1] = sei.length;
    assert.deepEqual(Buffer.from(output.samples[0]!.data), Buffer.from(concatBytes([seiPrefix, sei, prefix, picture])));
    if (lengthSize === 1) assert.throws(() => filterBitstream([source], `${insert}${"x".repeat(256)}`, new MediaBudgetTracker()), /exceeds NAL length/);
  });
}
