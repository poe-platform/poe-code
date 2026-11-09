import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function source() {
  const input = Buffer.alloc(44 + 24000 * 2);
  Buffer.from("524946460000000057415645666d74201000000001000100401f0000803e0000020010006461746100000000", "hex").copy(input);
  input.writeUInt32LE(input.length - 8, 4);
  input.writeUInt32LE(input.length - 44, 40);
  for (let i = 0; i < 24000; i++) input.writeInt16LE(i, 44 + i * 2);
  return Volume.fromJSON({ "/ramp.wav": input });
}

async function run(volume: Volume, options: string[], target = "/part%02d.wav", input = "/ramp.wav") {
  const args = ["-v", "error", "-i", input, "-c", "copy", "-f", "segment",
    "-segment_time", "1", "-segment_list", "/list.csv", ...options, target];
  const before = volume.toJSON();
  assert.equal(evalSyncFfmpeg(args, undefined,
    path => volume.readFileSync(path) as Buffer,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
  assert.deepEqual(volume.toJSON(), before);
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
  return { ...result, stderr };
}

for (const [format, extension] of [["s16le", "wav"], ["s16le", "unknown"], ["wav", "raw"], [undefined, "wav"]] as const) {
  it(`uses ${format ?? "inferred WAV"} segment contents with .${extension} filenames`, async () => {
    const volume = source();
    const result = await run(volume, format ? ["-segment_format", format] : [], `/part%02d.${extension}`);
    assert.equal(result.exitCode, 0, result.stderr);
    const parts = [0, 1, 2].map(index => volume.readFileSync(`/part0${index}.${extension}`) as Buffer);
    // Native FFmpeg 7.0.2: 3 seconds of mono PCM16 at 8000 Hz, samples 0..23999.
    const lengths = [8192, 8192, 7616];
    if (format === "s16le") {
      assert.deepEqual(parts.map(part => part.length), [16384, 16384, 15232]);
      assert.deepEqual(Buffer.concat(parts), (volume.readFileSync("/ramp.wav") as Buffer).subarray(44));
    } else {
      const channels = parts.map(part => parseWav(part).tracks[0]!.decodedAudio!.channelData[0]!);
      assert.deepEqual(channels.map(channel => channel.length), lengths);
      assert.deepEqual(channels.flatMap(channel => Array.from(channel)),
        Array.from(parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
    }
    assert.equal(volume.readFileSync("/list.csv", "utf8"),
      `part00.${extension},0.000000,1.024000\npart01.${extension},1.024000,2.048000\npart02.${extension},2.048000,3.000000\n`);
  });
}

it("uses MP4 segment contents despite a WAV filename suffix", async () => {
  const input = Buffer.from(createSyntheticMp4({ width: 32, height: 32, frameCount: 12, fps: 4, includeAudio: false }));
  const volume = Volume.fromJSON({ "/in.mp4": input });
  const result = await run(volume, ["-segment_format", "mp4"], "/part%02d.wav", "/in.mp4");
  assert.equal(result.exitCode, 0, result.stderr);
  const parts = volume.readdirSync("/").filter(name => String(name).startsWith("part"));
  const samples = parts.flatMap(name => parseMp4(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.samples);
  assert.deepEqual(samples.map(sample => sample.data), parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
});

for (const format of ["", "unknown", "segment", "s16be"]) {
  it(`rejects segment format ${JSON.stringify(format)} without replacing existing files`, async () => {
    const volume = source();
    volume.writeFileSync("/part00.wav", "keep segment");
    volume.writeFileSync("/list.csv", "keep list");
    const before = volume.toJSON();
    const result = await run(volume, ["-y", "-segment_format", format]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes(format === "s16be" ? "pcm_s16be" : "segment"), result.stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}

it("uses the selected raw encoder for every segment", async () => {
  const volume = source();
  const result = await run(volume, ["-segment_format", "s16be", "-c:a", "pcm_s16be"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const parts = [0, 1, 2].map(index => volume.readFileSync(`/part0${index}.wav`) as Buffer);
  assert.deepEqual(parts.map(part => part.length), [16384, 16384, 15232]);
  const expected = Buffer.from((volume.readFileSync("/ramp.wav") as Buffer).subarray(44)).swap16();
  assert.deepEqual(Buffer.concat(parts), expected);
});

it("protects existing raw segments unless overwrite is requested", async () => {
  const volume = source();
  volume.writeFileSync("/part01.wav", "keep");
  const before = volume.toJSON();
  assert.notEqual((await run(volume, ["-segment_format", "s16le"])).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  const result = await run(volume, ["-y", "-segment_format", "s16le"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((volume.readFileSync("/part01.wav") as Buffer).length, 16384);
});
