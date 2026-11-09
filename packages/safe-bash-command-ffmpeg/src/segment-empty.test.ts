import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function source() {
  return Volume.fromJSON({ "/ramp.wav": Buffer.from(encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 24000 }, (_, frame) => frame / 32768)] })) });
}

async function run(volume: Volume, options: string[]) {
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/ramp.wav", "-c", "copy", "-f", "segment",
      "-segment_time", "1", "-segment_list", "/list.csv", ...options, "/part%02d.wav"],
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

// Native FFmpeg 7.0.2: 50 segments, including empty parts 15, 31, and 47.
for (const value of [undefined, "0", "1"]) {
  it(`preserves the full ramp with write_empty_segments=${value ?? "default"}`, async () => {
    const volume = source();
    const result = await run(volume, ["-segment_time", "0.06",
      ...(value === undefined ? [] : ["-write_empty_segments", value])]);
    assert.equal(result.exitCode, 0, result.stderr);
    const rows = String(volume.readFileSync("/list.csv", "utf8")).trim().split("\n");
    assert.equal(rows.length, value === "1" ? 50 : 47);
    const samples: number[] = [];
    const empty: number[] = [];
    for (const [index, row] of rows.entries()) {
      const [name, start, end] = row.split(",");
      const bytes = volume.readFileSync(`/${name}`) as Buffer;
      const pcm = parseWav(bytes).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.equal(Number(start), samples.length / 8000);
      samples.push(...pcm);
      assert.equal(Number(end), samples.length / 8000);
      if (pcm.length === 0) empty.push(index);
    }
    assert.deepEqual(empty, value === "1" ? [15, 31, 47] : []);
    assert.deepEqual(samples, Array.from(parseWav(volume.readFileSync("/ramp.wav") as Buffer)
      .tracks[0]!.decodedAudio!.channelData[0]!));
  });
}

it("rejects invalid write_empty_segments before overwriting output", async () => {
  const volume = source();
  volume.writeFileSync("/part00.wav", "keep");
  const before = volume.toJSON();
  const result = await run(volume, ["-write_empty_segments", "invalid"]);
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(volume.toJSON(), before);
});

for (const options of [["-segment_time", "0"], ["-segment_times", "0,0,1,1"]]) {
  it(`finishes and preserves audio for ${options.join(" ")} with empty segments`, async () => {
    const volume = source();
    const result = await run(volume, [...options, "-write_empty_segments", "1"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const rows = String(volume.readFileSync("/list.csv", "utf8")).trim().split("\n");
    assert.equal(rows.length, options[0] === "-segment_time" ? 48 : 5);
    const samples = rows.flatMap(row => Array.from(parseWav(volume.readFileSync(`/${row.split(",")[0]}`) as Buffer)
      .tracks[0]!.decodedAudio!.channelData[0]!));
    assert.deepEqual(samples, Array.from(parseWav(volume.readFileSync("/ramp.wav") as Buffer)
      .tracks[0]!.decodedAudio!.channelData[0]!));
  });
}
