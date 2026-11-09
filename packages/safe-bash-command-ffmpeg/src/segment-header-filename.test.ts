import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function source(frames = 24000) {
  const input = Buffer.alloc(44 + frames * 2);
  Buffer.from("524946460000000057415645666d74201000000001000100401f0000803e0000020010006461746100000000", "hex").copy(input);
  input.writeUInt32LE(input.length - 8, 4);
  input.writeUInt32LE(input.length - 44, 40);
  for (let i = 0; i < frames; i++) input.writeInt16LE(i, 44 + i * 2);
  return Volume.fromJSON({ "/ramp.wav": input });
}

async function run(volume: Volume, options: string[] = [], header = "head.wav") {
  const args = ["-v", "error", "-i", "/ramp.wav", "-c", "copy", "-f", "segment",
    "-segment_header_filename", header, "-segment_list", "parts.csv", ...options, "part%02d.wav"];
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

for (const options of [[], ["-segment_format", "wav", "-metadata", "title=data in metadata"],
  ["-individual_header_trailer", "0"], ["-write_header_trailer", "0"],
  ["-individual_header_trailer", "0", "-write_header_trailer", "0"]]) {
  it(`writes a separate streaming WAV header and exact headerless PCM segments (${options.join(" ") || "defaults"})`, async () => {
    const volume = source();
    const result = await run(volume, options);
    assert.equal(result.exitCode, 0, result.stderr);
    const header = volume.readFileSync("/head.wav") as Buffer;
    // Native FFmpeg writes unknown RIFF/data sizes; encoder metadata may differ.
    assert.equal(header.toString("ascii", 0, 4), "RIFF");
    assert.equal(header.readUInt32LE(4), 0xffffffff);
    assert.equal(header.toString("ascii", 8, 12), "WAVE");
    assert.equal(header.toString("ascii", header.length - 8, header.length - 4), "data");
    assert.equal(header.readUInt32LE(header.length - 4), 0xffffffff);
    const parts = ["/part00.wav", "/part01.wav"].map(path => volume.readFileSync(path) as Buffer);
    assert.deepEqual(parts.map(part => part.length), [32768, 15232]);
    assert.deepEqual(Buffer.concat(parts), (volume.readFileSync("/ramp.wav") as Buffer).subarray(44));
    const restored = parseWav(Buffer.concat([header, ...parts]));
    assert.equal(restored.tracks[0]!.codecDescriptions[0]!.sampleRate, 8000);
    assert.deepEqual(restored.tracks[0]!.decodedAudio,
      parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!.decodedAudio);
    if (options.includes("-metadata")) assert.equal(restored.metadata.title, "data in metadata");
    assert.equal(volume.readFileSync("/parts.csv", "utf8"),
      "part00.wav,0.000000,2.048000\npart01.wav,2.048000,3.000000\n");
    assert.deepEqual(volume.readdirSync("/"), ["head.wav", "part00.wav", "part01.wav", "parts.csv", "ramp.wav"]);
  });
}

it("uses the requested WAV encoder for headerless segments", async () => {
  const volume = source();
  const result = await run(volume, ["-c:a", "pcm_f32le", "-segment_time", "1"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const header = volume.readFileSync("/head.wav") as Buffer;
  const parts = [0, 1, 2].map(index => volume.readFileSync(`/part0${index}.wav`) as Buffer);
  const restored = parseWav(Buffer.concat([header, ...parts]));
  assert.equal(restored.tracks[0]!.codecDescriptions[0]!.codecName, "pcm_f32le");
  assert.deepEqual(parts.map(part => part.length), [32768, 32768, 30464]);
  assert.deepEqual(restored.tracks[0]!.decodedAudio!.channelData,
    parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!.decodedAudio!.channelData);
  assert.equal(header.includes(Buffer.from("fact")), false);
});

for (const header of ["ramp.wav", "part00.wav", "part01.wav", "parts.csv", "./part00.wav", ""]) {
  it(`rejects colliding or empty header filename ${JSON.stringify(header)} without writes`, async () => {
    const volume = source();
    const before = volume.toJSON();
    const result = await run(volume, ["-y"], header);
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(volume.toJSON(), before);
  });
}

it("protects an existing header unless overwrite is requested", async () => {
  const volume = source();
  volume.writeFileSync("/head.wav", "keep header");
  const before = volume.toJSON();
  assert.notEqual((await run(volume)).exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
  const result = await run(volume, ["-y"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((volume.readFileSync("/head.wav") as Buffer).toString("ascii", 0, 4), "RIFF");
});

it("fails to open the header before replacing media segments", async () => {
  const volume = source();
  volume.writeFileSync("/part00.wav", "keep segment");
  const result = await run(volume, ["-y"], "missing/head.wav");
  assert.notEqual(result.exitCode, 0);
  assert.equal(volume.readFileSync("/part00.wav", "utf8"), "keep segment");
});


it("omits RIFF alignment padding from odd-length PCM8 segments", async () => {
  const volume = source(24001);
  const result = await run(volume, ["-c:a", "pcm_u8"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((volume.readFileSync("/part00.wav") as Buffer).length, 16384);
  assert.equal((volume.readFileSync("/part01.wav") as Buffer).length, 7617);
});

it("leaves RF64 header sizes unfinalized and preserves every PCM byte", async () => {
  const volume = source();
  const result = await run(volume, ["-rf64", "always"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const header = volume.readFileSync("/head.wav") as Buffer;
  assert.equal(header.toString("ascii", 0, 4), "RF64");
  assert.equal(header.readUInt32LE(4), 0xffffffff);
  assert.equal(header.toString("ascii", 12, 16), "ds64");
  assert.deepEqual(header.subarray(20, 48), Buffer.alloc(28));
  assert.equal(header.readUInt32LE(header.length - 4), 0xffffffff);
  assert.deepEqual(Buffer.concat([volume.readFileSync("/part00.wav") as Buffer,
    volume.readFileSync("/part01.wav") as Buffer]), (volume.readFileSync("/ramp.wav") as Buffer).subarray(44));
});

it("rejects unsupported separate-header formats before replacing outputs", async () => {
  const volume = source();
  volume.writeFileSync("/head.wav", "keep header");
  volume.writeFileSync("/parts.csv", "keep list");
  const before = volume.toJSON();
  const result = await run(volume, ["-y", "-segment_format", "mp4"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("segment_header_filename"), result.stderr);
  assert.deepEqual(volume.toJSON(), before);
});
