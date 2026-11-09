import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function source() {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/ramp.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 24000 }, (_, index) => index / 32768)] }));
  return volume;
}

async function run(volume: Volume, options: string[], target = "/part%02d.wav") {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/ramp.wav", "-c", "copy", "-f", "segment",
      "-segment_time", "1", "-segment_list", "/list.csv", ...options, target],
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

for (const start of [undefined, 0, 7, 98]) {
  it(`numbers segments from ${start ?? "the default zero"} without changing PCM or cut times`, async () => {
    const volume = source();
    const result = await run(volume, start === undefined ? [] : ["-segment_start_number", String(start)]);
    assert.equal(result.exitCode, 0, result.stderr);
    const names = [0, 1, 2].map(index => `part${String((start ?? 0) + index).padStart(2, "0")}.wav`);
    assert.deepEqual(volume.readdirSync("/"), ["list.csv", ...names, "ramp.wav"].sort());
    assert.equal(volume.readFileSync("/list.csv", "utf8"),
      `${names[0]},0.000000,1.024000\n${names[1]},1.024000,2.048000\n${names[2]},2.048000,3.000000\n`);
    const channels = names.map(name =>
      parseWav(volume.readFileSync(`/${name}`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
    assert.deepEqual(channels.map(channel => channel.length), [8192, 8192, 7616]);
    assert.deepEqual(channels.flatMap(channel => Array.from(channel)),
      Array.from(parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
  });
}

it("accepts the maximum segment start number", async () => {
  const volume = source();
  const result = await run(volume, ["-segment_start_number", "2147483647", "-segment_time", "10"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(volume.readFileSync("/list.csv", "utf8"), "part2147483647.wav,0.000000,3.000000\n");
});

it("applies segment wrapping to the requested start number", async () => {
  const volume = source();
  const result = await run(volume, ["-segment_start_number", "7", "-segment_wrap", "2"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(volume.readdirSync("/"), ["list.csv", "part00.wav", "part01.wav", "ramp.wav"]);
  assert.equal(volume.readFileSync("/list.csv", "utf8"),
    "part01.wav,0.000000,1.024000\npart00.wav,1.024000,2.048000\npart01.wav,2.048000,3.000000\n");
  assert.equal(parseWav(volume.readFileSync("/part01.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!.length, 7616);
});

for (const value of ["", " ", "-1", "2147483648", "1.5", "NaN", "Infinity", "7junk"]) {
  it(`rejects invalid segment start number ${JSON.stringify(value)} before writing`, async () => {
    const volume = source();
    const before = volume.toJSON();
    const result = await run(volume, ["-segment_start_number", value]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("segment_start_number"), result.stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}

it("checks overwrite protection at the requested sequence number", async () => {
  const volume = source();
  volume.writeFileSync("/part08.wav", "keep");
  const before = volume.toJSON();
  const refused = await run(volume, ["-segment_start_number", "7"]);
  assert.notEqual(refused.exitCode, 0);
  assert.ok(refused.stderr.includes("part08.wav"), refused.stderr);
  assert.deepEqual(volume.toJSON(), before);
  const overwritten = await run(volume, ["-y", "-segment_start_number", "7"]);
  assert.equal(overwritten.exitCode, 0, overwritten.stderr);
  assert.equal(parseWav(volume.readFileSync("/part08.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!.length, 8192);
});

it("detects segment-list collisions after applying the start number", async () => {
  const volume = source();
  const before = volume.toJSON();
  const result = await run(volume, ["-y", "-segment_start_number", "7", "-segment_list", "/part07.wav"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("collide"), result.stderr);
  assert.deepEqual(volume.toJSON(), before);
});
