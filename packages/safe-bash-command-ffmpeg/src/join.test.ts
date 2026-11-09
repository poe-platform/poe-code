import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const a = Array.from({ length: 8192 }, (_, i) => i % 8 < 4 ? 8192 : -8192);
const b = Array.from({ length: 4096 }, (_, i) => i < 2048 ? -16384 : 1024);
const join = "join=inputs=2:channel_layout=stereo:map=1.0-FL|0.0-FR";

async function run(filters: string[], inputs: number[][][] = [[a], [b]]) {
  const volume = Volume.fromJSON({ "/out.wav": "preserve" });
  for (const [index, channels] of inputs.entries()) {
    volume.writeFileSync(`/${index === 0 ? "a" : "b"}.wav`, encodeWav({ sampleRate: 8000,
      channels: channels.map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, bytes: volume.readFileSync("/out.wav") as Buffer };
}

for (const [graph, expected] of [
  [`[0:a][1:a]${join}[mix]`, [b, a.slice(0, b.length)]],
  [`[1:a][0:a]${join}[mix]`, [a.slice(0, b.length), b]],
  [`[0:a][1:a]${join},areverse[mix]`, [[...b].reverse(), a.slice(0, b.length).reverse()]]
] as const) {
  it(`routes join channels and stops at the shortest input: ${graph}`, async () => {
    const { result, stderr, bytes } = await run(["-filter_complex", graph, "-map", "[mix]"]);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 2);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, 4096);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
  });
}

for (const [index, expected] of [a, b].entries()) {
  it(`preserves direct audio stream mapping ${index}`, async () => {
    const { result, stderr, bytes } = await run(["-map", `${index}:a`]);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
  });
}

for (const map of ["2.0-FL|0.0-FR", "1.1-FL|0.0-FR", "1.0-FL|0.0-FL", "1.0-BOGUS|0.0-FR"]) {
  it(`rejects invalid join mapping without replacing output: ${map}`, async () => {
    const { result, stderr, bytes } = await run(["-filter_complex", `[0:a][1:a]join=inputs=2:channel_layout=stereo:map=${map}[mix]`, "-map", "[mix]"]);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /join/);
    assert.equal(bytes.toString(), "preserve");
  });
}

// Native FFmpeg matches speakers before falling back to unused input channels.
for (const [inputs, filter, expected] of [
  [[[8000], [12000, -2000]], "join", [12000, -2000]],
  [[[8000], [12000, -2000]], "join=map=0.0-FL", [8000, -2000]],
  [[[8000], [-4000]], "join", [8000, -4000]],
  [[[8000], [-4000]], "join=map=1.0-FL", [-4000, 8000]],
  [[[8000], [-4000]], "join=map=0.0-FR", [-4000, 8000]],
  [[[8000], [12000, -2000]], "join=map=1.0-FR", [8000, 12000]],
  [[[8000], [-4000]], "join=map=0.0-FL|0.0-FR", [8000, 8000]],
  [[[8000], [12000, -2000]], "join=map=1.1-FL|0.0-FR", [-2000, 8000]]
] as const) {
  it(`automatically assigns unused join channels: ${JSON.stringify(inputs)} ${filter}`, async () => {
    const { result, stderr, bytes } = await run([
      "-filter_complex", `[0:a][1:a]${filter}[mix]`, "-map", "[mix]"
    ], inputs.map(channels => channels.map(sample => Array<number>(32).fill(sample))));
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.equal(audio.channelMask ?? 3, 3);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      expected.map(sample => Array<number>(32).fill(sample)));
  });
}
