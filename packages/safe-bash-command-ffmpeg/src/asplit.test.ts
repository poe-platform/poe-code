import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const a = [11, 22, 33, 44];
const b = [-50, -60, -70, -80];
for (const [graph, expected] of [
  ["[1:a]asplit=2[x][y]", [b, b]],
  ["[1:a]asplit[x][y]", [b, b]],
  ["[1:a]asplit=outputs=2[x][t];[t]volume=0.5[y]", [b, b.map(x => x / 2)]],
  ["[1:a]volume=0.5,asplit=2[x][t];[t]areverse[y]", [b.map(x => x / 2), [...b].reverse().map(x => x / 2)]],
  ["[0:a]asplit=2[x][y]", [a, a]],
  ["[1:a]asplit=1[x]", [b]],
  ["[1:a]asplit=3[x][y][z]", [b, b, b]]
] as const) {
  for (const reverse of [false, true]) {
    it(`routes independent asplit branches: ${graph}, reverse=${reverse}`, async () => {
      const { result, volume, stderr } = await run(graph, expected.length, reverse);
      assert.equal(result.exitCode, 0, stderr);
      for (const [index, samples] of expected.entries()) {
        const audio = parseWav(volume.readFileSync(`/out${index}.wav`) as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channels, 1);
        assert.equal(audio.sampleRate, 8000);
        assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), samples);
      }
    });
  }
}
for (const filter of ["asplit=0", "asplit=-1", "asplit=1.5", "asplit=3", "asplit=", "asplit=unknown=2"]) {
  it(`rejects invalid split: ${filter}`, async () => {
    const { result } = await run(`[1:a]${filter}[x][y]`, 2);
    assert.notEqual(result.exitCode, 0);
  });
}

for (const split of ["asplit", "asplit=2", "asplit=outputs=2"]) {
  for (const crossfade of [false, true]) {
    it(`mixes both ${split} outputs in one graph, crossfade=${crossfade}`, async () => {
      const first = Array<number>(1000).fill(12000);
      const second = Array<number>(1000).fill(-4000);
      const source = crossfade ? "[0:a][1:a]acrossfade=ns=4[z];[z]" : "[0:a]";
      const { result, volume, stderr } = await run(
        `${source}${split}[left][right];[left][right]amix=inputs=2[x]`, 1, false, first, second);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out0.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 1);
      assert.equal(audio.sampleRate, 8000);
      // Native FFmpeg PCM16 reference for the 1,000-frame constant inputs.
      const expected = crossfade
        ? [...first.slice(0, 996), 9000, 5000, 1000, -3000, ...second.slice(4)]
        : first;
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
    });
  }
}

async function run(graph: string, count: number, reverse = false, first = a, second = b) {
  const volume = Volume.fromJSON({ "/out0.wav": "keep" });
  for (const [path, samples] of [["/a.wav", first], ["/b.wav", second]] as const) {
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from(samples, sample => sample / 32768)] }));
  }
  const outputs = Array.from({ length: count }, (_, i) => ["-map", `[${["x", "y", "z"][i]}]`, `/out${i}.wav`]);
  if (reverse) outputs.reverse();
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex", graph, ...outputs.flat()],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, volume, stderr };
}
