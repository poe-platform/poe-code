import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const cases: [string, number[]][] = [];
for (const [layout, left, right] of [
  ["downmix", "DL", "DR"], ["DL+DR", "DL", "DR"],
  ["WL+WR", "WL", "WR"],
  ["0x180000000", "WL", "WR"]
]) {
  const join = `[0:a][1:a]join=channel_layout=${layout}:map=0.0-${left}|1.1-${right}`;
  cases.push([`${join}[o]`, [1000, 4000]],
    [`${join},pan=mono|FC=${right}[o]`, [4000]]);
}
for (const speaker of ["DL", "DR", "WL", "WR", "SDL", "SDR", "LFE2", "TSL", "TSR", "BFC", "BFL", "BFR"]) {
  cases.push([
    `[1:a]channelmap=1-${speaker}[b];[0:a][b]join=channel_layout=mono:map=1.${speaker}-FC[o]`,
    [4000]
  ], [
    `[1:a]channelmap=1-${speaker}[b];[0:a][b]join=channel_layout=${speaker},channelmap=${speaker}[o]`,
    [4000]
  ]);
}
// Native FFmpeg routes these 512-frame PCM16 inputs without changing their samples.
for (const [graph, samples] of cases) {
  it(`joins extended speakers: ${graph}`, async () => {
    const inputs = [[1000, 2000], [3000, 4000]].map(values => Buffer.from(encodeWav({
      sampleRate: 8000, channels: values.map(value => new Float64Array(512).fill(value / 32768))
    })));
    const volume = Volume.fromJSON({ "/a.wav": inputs[0]!, "/b.wav": inputs[1]!, "/out.pcm": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex", graph,
        "-map", "[o]", "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const expected = Buffer.alloc(512 * samples.length * 2);
    for (let frame = 0; frame < 512; frame++) {
      samples.forEach((sample, channel) => expected.writeInt16LE(sample, (frame * samples.length + channel) * 2));
    }
    assert.deepEqual(volume.readFileSync("/out.pcm"), expected);
    assert.deepEqual(volume.readFileSync("/a.wav"), inputs[0]);
    assert.deepEqual(volume.readFileSync("/b.wav"), inputs[1]);
  });
}
