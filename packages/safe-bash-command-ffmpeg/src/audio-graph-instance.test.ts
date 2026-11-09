import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string, values: number[]) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [index, value] of values.entries()) {
    volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(1000).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/0.wav", "-i", "/1.wav", "-filter_complex", graph,
      "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.wav") as Buffer };
}

for (const [filter, values, expected] of [
  ["acrossfade@join=ns=4", [12000, -4000],
    [[...Array<number>(996).fill(12000), 9000, 5000, 1000, -3000, ...Array<number>(996).fill(-4000)]]],
  ...["amerge@pair", "amerge@pair=2", "amerge@pair=inputs=2"].map(filter =>
    [filter, [8000, -4000], [Array<number>(1000).fill(8000), Array<number>(1000).fill(-4000)]] as const)
] as const) {
  for (const downstream of [false, true]) {
    it(`${filter} preserves native PCM and WAV layout (downstream=${downstream})`, async () => {
      const graph = `[0:a][1:a]${filter}${downstream ? ",volume@gain=0.5" : ""}[out]`;
      const result = await run(graph, [...values]);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(result.output).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, expected.length);
      assert.equal(audio.channelMask ?? (audio.channels === 1 ? 4 : 3), expected.length === 1 ? 4 : 3);
      assert.deepEqual(audio.channelData.map(samples => Array.from(samples, value => value * 32768)),
        expected.map(samples => samples.map(value => value * (downstream ? 0.5 : 1))));
    });
  }
}

for (const [graph, error] of [
  ["[0:a]acrossfade@join=ns=4[out]", "acrossfade requires two inputs"],
  ["[0:a][1:a]acrossfade@join=ns=0[out]", "acrossfade: invalid sample count"],
  ["[0:a]amerge@pair[out]", "amerge requires two inputs"],
  ["[0:a][1:a]amerge@pair=inputs=3[out]", "amerge requires two inputs"]
]) {
  it(`validates named filter without replacing output: ${graph}`, async () => {
    const result = await run(graph!, [8000, -4000]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes(error!), result.stderr);
    assert.equal(result.output.toString(), "keep");
  });
}
