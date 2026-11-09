import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(graph: string, inputs = 2) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  for (const [index, value] of [12000, -4000, 8000].slice(0, inputs).entries()) {
    volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(1000).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...Array.from({ length: inputs }, (_, index) => ["-i", `/${index}.wav`]).flat(),
      "-filter_complex", graph, "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, volume };
}

for (const filter of ["acrossfade=ns=4", "amerge", "amerge=2", "amerge=inputs=2"]) {
  for (const { prefix, first, second, inputs } of [
    { prefix: "", first: 12000, second: -4000, inputs: 2 },
    { prefix: "[0:a]", first: 12000, second: -4000, inputs: 2 },
    { prefix: "[1:a]", first: -4000, second: 12000, inputs: 2 },
    { prefix: "[1:0]", first: -4000, second: 12000, inputs: 2 },
    { prefix: "[0:a][1:a]", first: 12000, second: -4000, inputs: 2 },
    { prefix: "[1:a][0:a]", first: -4000, second: 12000, inputs: 2 },
    { prefix: "[1:a][1:a]", first: -4000, second: -4000, inputs: 2 },
    { prefix: "[0:a]anullsink;[2:a]", first: 8000, second: -4000, inputs: 3 },
    { prefix: "[1:a]anull[a];[a]", first: -4000, second: 12000, inputs: 2 }
  ]) {
    it(`binds unused audio streams for ${prefix}${filter}`, async () => {
      const { exitCode, stderr, volume } = await run(`${prefix}${filter}[o]`, inputs);
      assert.equal(exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      const samples = audio.channelData.map(channel => Array.from(channel, value => Math.round(value * 32768)));
      if (filter.startsWith("acrossfade")) {
        assert.equal(audio.channels, 1);
        assert.deepEqual(samples, [[...new Array(996).fill(first),
          first * 3 / 4, first / 2 + second / 4, first / 4 + second / 2, second * 3 / 4,
          ...new Array(996).fill(second)]]);
      } else {
        assert.equal(audio.channels, 2);
        assert.equal(audio.channelMask ?? 3, 3);
        assert.deepEqual(samples, [new Array(1000).fill(first), new Array(1000).fill(second)]);
      }
    });
  }
  for (const prefix of ["", "[0:a]", "[0:a]anullsink;"]) {
    it(`rejects missing streams for ${prefix}${filter} without replacing output`, async () => {
      const { exitCode, stderr, volume } = await run(`${prefix}${filter}[o]`, 1);
      assert.equal(exitCode, 1, stderr);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
    });
  }
}
