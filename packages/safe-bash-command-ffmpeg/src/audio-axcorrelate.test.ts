import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, channels = 1, secondLength = 4096, firstLength = 8192, inputs?: [Uint8Array, Uint8Array]) {
  const fs = Volume.fromJSON({});
  const a = Float64Array.from({ length: firstLength }, (_, i) => (i % 8 < 4 ? 8192 : -8192) / 32768);
  const b = Float64Array.from({ length: secondLength }, (_, i) => (i < 2048 ? -16384 : 1024) / 32768);
  fs.writeFileSync("/a.wav", inputs?.[0] ?? encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, () => a) }));
  fs.writeFileSync("/b.wav", inputs?.[1] ?? encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, c) => c ? b.map(x => -x) : b) }));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/a.wav", "-i", "/b.wav", ...(filter.startsWith("[") ? ["-filter_complex", filter, "-map", "[mix]"] : ["-map", filter]), "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  const bytes = fs.existsSync("/out.wav") ? fs.readFileSync("/out.wav") as Buffer : undefined;
  return { result, error: Buffer.concat(errors).toString(), bytes, audio: bytes ? parseWav(bytes).tracks[0]!.decodedAudio! : undefined };
}

for (const branch of [0, 1]) for (const filter of ["volume=-1", "volume=0", "anull"]) {
  it(`axcorrelate applies ${filter} to input branch ${branch}`, async () => {
    const samples = Float64Array.from({ length: 4000 }, (_, i) => (i % 8 < 4 ? 8192 : -8192) / 32768);
    const input = encodeWav({ sampleRate: 8000, channels: [samples] });
    const graph = `[${branch}:a]${filter}[filtered];${branch === 0 ? "[filtered][1:a]" : "[0:a][filtered]"}axcorrelate=128:best[mix]`;
    const { result, error, audio } = await run(graph, 1, 4000, 4000, [input, input]);
    assert.equal(result.exitCode, 0, error);
    assert.equal(audio!.sampleRate, 8000);
    assert.equal(audio!.channels, 1);
    const expected = filter === "volume=-1" ? -32768 : filter === "volume=0" ? 0 : 32767;
    assert.equal(audio!.channelData[0]!.length, 4000);
    for (const sample of audio!.channelData[0]!) assert.equal(sample * 32768, expected);
  });
}

for (const branch of [0, 1]) {
  it(`axcorrelate preserves branch ${branch} when applying upstream filters`, async () => {
    const graph = `[${branch}:a]volume=-1,atrim=end_sample=3109[filtered];${branch === 0 ? "[filtered][1:a]" : "[0:a][filtered]"}axcorrelate=128:best,volume=0.5[mix]`;
    const input = await run(`${branch}:a`);
    const samples = Float64Array.from(input.audio!.channelData[0]!.subarray(0, 3109), value => -value);
    const filtered = encodeWav({ sampleRate: 8000, channels: [samples] });
    const other = await run(`${1 - branch}:a`);
    const expected = await run("[0:a][1:a]axcorrelate=128:best,volume=0.5[mix]", 1, 4096, 8192,
      branch === 0 ? [filtered, other.bytes!] : [other.bytes!, filtered]);
    const actual = await run(graph);
    assert.equal(expected.result.exitCode, 0, expected.error);
    assert.equal(actual.result.exitCode, 0, actual.error);
    assert.deepEqual(actual.audio, expected.audio);
  });
}

for (const channels of [1, 2]) for (const algo of ["slow", "best", "0", "2"]) {
  it(`axcorrelate ${algo} matches native PCM at steady regions and boundaries (${channels} channels)`, async () => {
    const { result, error, audio } = await run(`[0:a][1:a]axcorrelate=size=128:algo=${algo}[mix]`, channels);
    assert.equal(result.exitCode, 0, error);
    assert.equal(audio!.sampleRate, 8000);
    assert.equal(audio!.channels, channels);
    for (const [c, channel] of audio!.channelData.entries()) {
      assert.equal(channel.length, 4096);
      const expected = [0, 0, 0, 2908, 0, 0, -2908];
      [0, 4, 512, 2047, 2048, 2304, 4095].forEach((index, i) => {
        assert.ok(Math.abs(channel[index]! * 32768 - expected[i]! * (c ? -1 : 1)) <= 1, `sample ${index}: ${channel[index]! * 32768}`);
      });
    }
  });
}

it("direct input maps preserve their original PCM and lengths", async () => {
  for (const input of [0, 1]) {
    const { result, error, audio } = await run(`${input}:a`);
    assert.equal(result.exitCode, 0, error);
    assert.equal(audio!.channelData[0]!.length, input ? 4096 : 8192);
    assert.equal(audio!.channelData[0]![0]! * 32768, input ? -16384 : 8192);
  }
});

for (const option of ["size=1", "size=1.9", "size=131073", "size=131072.1", "size=2*131072", "size=1/0", "size=0/0", "size=2*", "size=", "algo=unknown", "unknown=1"]) {
  it(`axcorrelate rejects ${option}`, async () => {
    const { result, error, audio } = await run(`[0:a][1:a]axcorrelate=${option}[mix]`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(error.includes("axcorrelate"));
    assert.equal(audio, undefined);
  });
}

it("axcorrelate fast uses uncentered windows and applies following filters", async () => {
  const { result, error, audio } = await run("[0:a][1:a]axcorrelate=128:fast,volume=0.5[mix]");
  assert.equal(result.exitCode, 0, error);
  assert.equal(audio!.channelData[0]!.length, 4096);
  assert.equal(audio!.channelData[0]![0], 0);
  assert.ok(Math.abs(audio!.channelData[0]![4095]! * 32768 + 1448) <= 1);
});

it("axcorrelate defaults to best with a 256-sample window", async () => {
  const implicit = await run("[0:a][1:a]axcorrelate[mix]");
  const explicit = await run("[0:a][1:a]axcorrelate=256:best[mix]");
  assert.equal(implicit.result.exitCode, 0, implicit.error);
  assert.equal(explicit.result.exitCode, 0, explicit.error);
  assert.deepEqual(implicit.audio, explicit.audio);
});

for (const length of [512, 513, 1025]) for (const reverse of [false, true]) for (const algo of ["best", "fast"]) {
  it(`axcorrelate drains available packets at EOF (${length}, reversed=${reverse}, ${algo})`, async () => {
    const inputs = reverse ? "[1:a][0:a]" : "[0:a][1:a]";
    const { result, error, audio } = await run(`${inputs}axcorrelate=128:${algo}[mix]`, 1, 4096, length);
    assert.equal(result.exitCode, 0, error);
    const channel = audio!.channelData[0]!;
    assert.equal(channel.length, length);
    // Native FFmpeg PCM16 output for these deterministic WAV inputs.
    const expected = length === 512 && !reverse
      ? (algo === "best" ? [0, 23, 0, 32767, 32767] : [0, 258, 0, 32767, 32767])
      : algo === "best" ? [0, 0, 0, 0, 0]
      : length === 512 ? [0, 257, 0, 5793, 2896] : [0, 257, 0, 2896, -2896];
    [length - 128, length - 127, length - 64, length - 4, length - 1].forEach((index, i) => {
      assert.ok(Math.abs(channel[index]! * 32768 - expected[i]!) <= 1, `sample ${index}: ${channel[index]! * 32768}`);
    });
  });
}

// Native FFmpeg 9.0.1, -filter_complex_threads 1, with each input passed
// through asetnsamples=n=4096:p=0 before axcorrelate=128:ALGO.
// Buffer the entire short input to avoid native threaded EOF scheduling races.
// Output: -map '[o]' -f s16le expected.pcm
for (const [a, b] of [["d", "e"], ["aquiet", "bquiet"]]) {
  for (const algo of ["best", "fast", "slow"]) {
    it(`axcorrelate ${algo} matches every native sample for ${a}/${b}, including the tail`, async () => {
      const fixture = (name: string) => readFileSync(new URL(`./fixtures/axcorrelate/${name}`, import.meta.url));
      const expected = fixture(`${a}-${algo}.pcm`);
      const { result, error, audio } = await run(`[0:a][1:a]axcorrelate=128:${algo}[mix]`, 1, 3109, 3109,
        [fixture(`${a}.wav`), fixture(`${b}.wav`)]);
      assert.equal(result.exitCode, 0, error);
      const actual = audio!.channelData[0]!;
      assert.equal(actual.length, expected.length / 2);
      for (let i = 0; i < actual.length; i++) {
        assert.ok(Math.abs(actual[i]! * 32768 - expected.readInt16LE(i * 2)) <= 1,
          `sample ${i}: got ${actual[i]! * 32768}, expected ${expected.readInt16LE(i * 2)}`);
      }
    });
  }
}

for (const [expression, literal] of [["2*4", "8"], ["2.5", "2"], ["2.6", "3"], ["3.5", "4"], ["8.4", "8"]]) {
  for (const named of [false, true]) {
    it(`axcorrelate ${named ? "named" : "positional"} size ${expression} matches ${literal} output bytes`, async () => {
      const actual = await run(`[0:a][1:a]axcorrelate=${named ? "size=" : ""}${expression}:algo=slow[mix]`);
      const expected = await run(`[0:a][1:a]axcorrelate=size=${literal}:algo=slow[mix]`);
      assert.equal(actual.result.exitCode, 0, actual.error);
      assert.equal(expected.result.exitCode, 0, expected.error);
      assert.ok(expected.bytes!.length > 44);
      assert.deepEqual(actual.bytes, expected.bytes);
      if (expression === "2.5") {
        const roundedUp = await run("[0:a][1:a]axcorrelate=size=3:algo=slow[mix]");
        assert.equal(roundedUp.result.exitCode, 0, roundedUp.error);
        assert.notDeepEqual(actual.bytes, roundedUp.bytes);
      }
    });
  }
}

it("axcorrelate accepts expressions at the maximum window size", async () => {
  const actual = await run("[0:a][1:a]axcorrelate=size=2^17:algo=fast[mix]");
  const expected = await run("[0:a][1:a]axcorrelate=size=131072:algo=fast[mix]");
  assert.equal(actual.result.exitCode, 0, actual.error);
  assert.equal(expected.result.exitCode, 0, expected.error);
  assert.deepEqual(actual.bytes, expected.bytes);
});

for (const size of [64, 128, 600]) {
  it(`axcorrelate preserves downstream frame counts and timestamps (size=${size})`, async () => {
    const input = encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 4000 }, (_, i) => i % 8 < 4 ? 0.25 : -0.25)] });
    const execute = (following: string) => run(`[0:a][1:a]axcorrelate=${size}:best,${following}[mix]`,
      1, 4000, 4000, [input, input]);
    const lengths = size === 600 ? [424, 512, 512, 512, 512, 512, 416, 600]
      : [512 - size, 512, 512, 512, 512, 512, 512, 416, size];
    const baseline = await execute("anull");
    const numbered = await execute("volume=n:eval=frame");
    const timed = await execute("volume=t:eval=frame");
    for (const output of [baseline, numbered, timed]) assert.equal(output.result.exitCode, 0, output.error);
    assert.equal(baseline.audio!.channelData[0]!.length, 4000);
    let start = 0;
    for (const [n, length] of lengths.entries()) {
      const selected = await execute(`aselect='eq(n,${n})'`);
      assert.equal(selected.result.exitCode, 0, selected.error);
      assert.equal(selected.audio!.channelData[0]!.length, length);
      assert.deepEqual(selected.audio!.channelData[0], baseline.audio!.channelData[0]!.slice(start, start + length));
      for (let i = start; i < start + length; i++) {
        assert.equal(numbered.audio!.channelData[0]![i]! * 32768, n === 0 ? 0 : 32767);
        assert.ok(Math.abs(timed.audio!.channelData[0]![i]! * 32768 - Math.round(start / 8000 * 32768)) <= 1);
      }
      start += length;
    }
    assert.equal(start, 4000);
  });
}
