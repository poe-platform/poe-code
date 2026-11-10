import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const channels = [[1000, 2000, 3000, 4000], [-4000, -3000, -2000, -1000]];

// Native FFmpeg parses an integer and the next character for S/s units,
// then falls back to a floating-point prefix in milliseconds for other forms.
for (const [delays, offsets] of [
  ["+2S|1S", [2, 1]], ["+2s|1S", [16000, 1]],
  ["2S|1S", [2, 1]], ["2s|1S", [16000, 1]],
  ["0.5ms|1S", [4, 1]], ["2Sabc|1S", [2, 1]],
  ["2msfoo|1S", [16, 1]], ["+2sabc|1S", [16000, 1]],
  ["+0.5ms|1S", [4, 1]], ["2.0S|1S", [16, 1]],
  ["2.0s|1S", [16, 1]], ["2e0S|1S", [16, 1]],
  ["2 S|1S", [16, 1]], ["2foo|1S", [16, 1]],
  ["+2Sabc:all=1", [2, 2]],
  ["-0.1249|1S", [0, 1]], ["1S|-0.02", [1, 0]],
  ["-0.0", [0, 0]]
] as const) {
  for (const graph of [false, true]) {
    it(`adelay=${delays} matches native channel placement (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result, stderr } = await run(delays, graph);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      for (const [channel, samples] of channels.entries()) {
        const expected = new Array<number>(4 + Math.max(...offsets)).fill(0);
        samples.forEach((value, index) => { expected[index + offsets[channel]!] = value; });
        assert.deepEqual(Array.from(audio.channelData[channel]!, value => Math.round(value * 32768)), expected);
      }
    });
  }
}

for (const delays of ["bad|1S", "-1S|1S", "-1s|1S", "-0.125|1S", "1S|-0.125", "NaNS|1S", "Infinity|1S", "1e400ms|1S"]) {
  for (const graph of [false, true]) {
    it(`adelay=${delays} rejects invalid input without replacing output (${graph ? "graph" : "simple"})`, async () => {
      const { volume, result } = await run(delays, graph);
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
    });
  }
}

async function run(delays: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.wav": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: channels.map(channel => Float64Array.from(channel, value => value / 32768)) }));
  let stderr = "";
  const filter = `adelay=${delays}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
