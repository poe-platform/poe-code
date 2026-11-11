import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filters: string[], inputs: number[][][], rates: number[] = []) {
  const volume = Volume.fromJSON({ "/out.wav": "preserve" });
  for (const [index, channels] of inputs.entries()) {
    volume.writeFileSync(`/${index}.wav`, encodeWav({ sampleRate: rates[index] ?? 8000,
      channels: channels.map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", ...inputs.flatMap((_, index) => ["-i", `/${index}.wav`]), ...filters, "-c:a", "pcm_s16le", "/out.wav"],
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

for (const count of ["2", "1+1", "02", "2.5", "1.5", "1.9", "2.49", "min+1"]) {
  it(`evaluates join inputs=${count} with native integer rounding`, async () => {
    const { result, stderr, bytes } = await run([
      "-filter_complex", `[0:a][1:a]join=inputs=${count}:map=0.0-FL|1.0-FR[o]`, "-map", "[o]"
    ], [[[8000, 8000]], [[-4000, -4000]]]);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.equal(audio.channelMask ?? 3, 3);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      [[8000, 8000], [-4000, -4000]]);
  });
}

for (const options of ["inputs=default", "default:stereo", "inputs=default+0.5", "inputs=1:inputs=default"]) {
  it(`resolves join's default input count: ${options}`, async () => {
    const inputs = [[1000, 2000], [3000, 4000]].map(channels =>
      channels.map(sample => Array<number>(512).fill(sample)));
    const { result, stderr, bytes } = await run([
      "-filter_complex", `[0:a][1:a]join=${options}:map=0.0-FL|1.1-FR[o]`, "-map", "[o]"
    ], inputs);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
      [Array<number>(512).fill(1000), Array<number>(512).fill(4000)]);
  });
}

for (const options of ["inputs=min", "min:stereo", "inputs=min+0", "inputs=1", "inputs=default-1"]) {
  it(`resolves join's minimum input count: ${options}`, async () => {
    const channels = [[10, 20, 30, 40, 50], [100, 200, 300, 400, 500]];
    const { result, stderr, bytes } = await run([
      "-filter_complex", `[0:a]join=${options}[o]`, "-map", "[o]"
    ], [channels]);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), channels);
  });
}

for (const count of ["", "0", "-1", "0.9", "32767.1", "NaN", "Infinity", "1/0", "0/0", "1+", "3.5", "2.51", "1", "3", "default-2", "default+1", "DEFAULT", "defaultfoo", "min", "min-1", "min-0.1", "MIN", "minimum"]) {
  it(`rejects invalid or mismatched join inputs=${count} without replacing output`, async () => {
    const { result, bytes } = await run([
      "-filter_complex", `[0:a][1:a]join=inputs=${count}:map=0.0-FL|1.0-FR[o]`, "-map", "[o]"
    ], [[[8000]], [[-4000]]]);
    assert.notEqual(result.exitCode, 0);
    assert.equal(bytes.toString(), "preserve");
  });
}
