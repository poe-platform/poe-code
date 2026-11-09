import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function source() {
  const input = Buffer.alloc(44 + 24000 * 2);
  Buffer.from("524946460000000057415645666d74201000000001000100401f0000803e0000020010006461746100000000", "hex").copy(input);
  input.writeUInt32LE(input.length - 8, 4);
  input.writeUInt32LE(input.length - 44, 40);
  for (let i = 0; i < 24000; i++) input.writeInt16LE(i, 44 + i * 2);
  return Volume.fromJSON({ "/ramp.wav": input });
}

async function run(volume: Volume, output: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/ramp.wav", "-c", "copy", ...output],
    cwd: "/", env: {}, signal: new AbortController().signal,
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

for (const [options, extension, starts] of [
  [[], "mkv", [0, 2.048]],
  [["-reset_timestamps", "1"], "mkv", [0, 0]],
  [["-segment_format", "matroska"], "bin", [0, 2.048]]
] as const) {
  it(`copies PCM into Matroska segments with packet timing and exact payload (${options.join(" ") || "defaults"})`, async () => {
    const volume = source();
    const args = ["-f", "segment", "-segment_list", "/parts.csv", ...options, `/part%02d.${extension}`];
    const before = volume.toJSON();
    assert.equal(evalSyncFfmpeg(["-i", "/ramp.wav", "-c", "copy", ...args], undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.deepEqual(volume.toJSON(), before);
    const result = await run(volume, args);
    assert.equal(result.exitCode, 0, result.stderr);
    const tracks = [0, 1].map(index => parseMkv(volume.readFileSync(`/part0${index}.${extension}`) as Buffer).tracks[0]!);
    // Native FFmpeg 7.0.2: 24000 mono PCM16 samples at 8000 Hz, cut at 2.048 seconds.
    assert.deepEqual(tracks.map(track => track.samples.reduce((sum, sample) => sum + sample.data.length / 2, 0)), [16384, 7616]);
    assert.deepEqual(tracks.map(track => track.samples[0]!.pts / track.timescale), starts);
    const original = parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!;
    assert.deepEqual(tracks.flatMap((track, index) => track.samples.map(sample =>
      sample.pts * 1000 / track.timescale + (options[0] === "-reset_timestamps" && index === 1 ? 2048 : 0))),
    original.samples.map(sample => sample.pts * 1000 / original.timescale));
    assert.deepEqual(tracks.flatMap(track => track.samples.map(sample => sample.duration * 1000 / track.timescale)),
      original.samples.map(sample => sample.duration * 1000 / original.timescale));
    for (const track of tracks) {
      assert.equal(track.codecDescriptions[0]!.codecName, "pcm_s16le");
      assert.equal(track.codecDescriptions[0]!.sampleRate, 8000);
      assert.equal(track.codecDescriptions[0]!.channels, 1);
    }
    assert.deepEqual(Buffer.concat(tracks.flatMap(track => track.samples.map(sample => sample.data))),
      (volume.readFileSync("/ramp.wav") as Buffer).subarray(44));
    assert.equal(volume.readFileSync("/parts.csv", "utf8"),
      `part00.${extension},0.000000,2.048000\npart01.${extension},2.048000,3.000000\n`);
  });
}

it("keeps single-file Matroska and WAV segment PCM copy working", async () => {
  const volume = source();
  for (const output of [["/one.mkv"], ["-f", "segment", "/part%02d.wav"]]) {
    const result = await run(volume, output);
    assert.equal(result.exitCode, 0, result.stderr);
  }
  const expected = (volume.readFileSync("/ramp.wav") as Buffer).subarray(44);
  const mkv = parseMkv(volume.readFileSync("/one.mkv") as Buffer).tracks[0]!;
  assert.deepEqual(Buffer.concat(mkv.samples.map(sample => sample.data)), expected);
  const wav = [0, 1].map(index => parseWav(volume.readFileSync(`/part0${index}.wav`) as Buffer).tracks[0]!);
  assert.deepEqual(Buffer.concat(wav.flatMap(track => track.samples.map(sample => sample.data))), expected);
});

it("protects existing Matroska segments until overwrite is requested", async () => {
  const volume = source();
  volume.writeFileSync("/part01.mkv", "keep");
  const before = volume.toJSON();
  const output = ["-f", "segment", "-segment_list", "/parts.csv", "/part%02d.mkv"];
  assert.notEqual((await run(volume, output)).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  const result = await run(volume, ["-y", ...output]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(parseMkv(volume.readFileSync("/part01.mkv") as Buffer).tracks[0]!.samples[0]!.pts, 2048);
});
