import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function source() {
  return Volume.fromJSON({ "/ramp.wav": Buffer.from(encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 24000 }, (_, index) => index / 32768)] })) });
}

async function run(volume: Volume, options: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/ramp.wav", "-c", "copy", "-f", "segment",
      "-segment_time", "1", ...options, "/part%02d.wav"],
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

for (const [size, expected] of [
  ["2", "part01.wav,1.024000,2.048000\npart02.wav,2.048000,3.000000\n"],
  ["1", "part02.wav,2.048000,3.000000\n"],
  ["0", "part00.wav,0.000000,1.024000\npart01.wav,1.024000,2.048000\npart02.wav,2.048000,3.000000\n"],
  ["5", "part00.wav,0.000000,1.024000\npart01.wav,1.024000,2.048000\npart02.wav,2.048000,3.000000\n"],
  ["2147483647", "part00.wav,0.000000,1.024000\npart01.wav,1.024000,2.048000\npart02.wav,2.048000,3.000000\n"]
] as const) {
  it(`limits the segment list to ${size} entries while retaining every audio sample`, async () => {
    const volume = source();
    const result = await run(volume, ["-segment_list", "/list.csv", "-segment_list_size", size]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(volume.readFileSync("/list.csv", "utf8"), expected);
    assert.deepEqual(volume.readdirSync("/"), ["list.csv", "part00.wav", "part01.wav", "part02.wav", "ramp.wav"]);
    const pcm = [0, 1, 2].map(index =>
      parseWav(volume.readFileSync(`/part0${index}.wav`) as Buffer).tracks[0]!.decodedAudio!.channelData[0]!);
    assert.deepEqual(pcm.map(channel => channel.length), [8192, 8192, 7616]);
    assert.deepEqual(pcm.flatMap(channel => Array.from(channel)),
      Array.from(parseWav(volume.readFileSync("/ramp.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!));
  });
}

it("accepts a segment list size without a list destination", async () => {
  const volume = source();
  const result = await run(volume, ["-segment_list_size", "1"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(volume.readdirSync("/"), ["part00.wav", "part01.wav", "part02.wav", "ramp.wav"]);
});

for (const value of [undefined, "", " ", "-1", "1.5", "NaN", "Infinity", "2147483648"]) {
  it(`rejects invalid segment list size ${JSON.stringify(value)} before writing`, async () => {
    const volume = source();
    volume.writeFileSync("/list.csv", "keep list");
    volume.writeFileSync("/part00.wav", "keep segment");
    const before = volume.toJSON();
    const result = await run(volume, ["-segment_list", "/list.csv", "-segment_list_size", ...(value === undefined ? [] : [value])]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("segment_list_size"), result.stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}
