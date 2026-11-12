import assert from "node:assert/strict";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 16 }, (_, i) => (i + 1) * 1000);
const smooth = "adynamicsmooth@sm=0:2";

async function run(filter: string, graph = false, channels = [input]) {
  const fs = createMemoryFileSystem();
  const pcm = Buffer.alloc(input.length * channels.length * 2);
  for (let i = 0; i < input.length; i++) {
    for (const [c, channel] of channels.entries()) pcm.writeInt16LE(channel[i]!, (i * channels.length + c) * 2);
  }
  await fs.writeFile("/in.raw", pcm);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", String(channels.length), "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "/out.raw"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const output = Buffer.from(await fs.readFile("/out.raw"));
  assert.equal(output.length, pcm.length);
  return Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
}

// Native FFmpeg 7.0.2 PCM16: the first eight samples retain the original settings.
for (const graph of [false, true]) {
  for (const [option, value, original, samples, initial] of [
    ["basefreq", 150, 2, [2158, 5572, 7984, 9635, 10906, 12012, 13052, 14067],
      [117, 541, 1266, 2149, 3103, 4085, 5079, 6076, 7076, 8075, 9075, 10075, 11075, 12075, 13075, 14075]],
    ["sensitivity", 10, 0, [1409, 7146, 10000, 10595, 11504, 12749, 13740, 14629],
      [0, 1, 12, 326, 2981, 5000, 5595, 6504, 7749, 8740, 9629, 10650, 11704, 12682, 13661, 14676]]
  ] as const) {
    it(`adynamicsmooth applies timed ${option} without resetting history (graph=${graph})`, async () => {
      const baseline = await run(`asetnsamples=4:0,${smooth}`, graph);
      assert.deepEqual(baseline, [0, 0, 1, 2, 3, 5, 8, 12, 17, 23, 30, 39, 49, 61, 74, 90]);
      const output = await run(`asetnsamples=4:0,asendcmd=c='0.008 adynamicsmooth@sm ${option} ${value}',${smooth}`, graph);
      assert.deepEqual(output, [...baseline.slice(0, 8), ...samples]);
      assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.008 adynamicsmooth@sm ${option} ${original}',${smooth}`, graph), baseline);
    });

    it(`adynamicsmooth applies ${option} at time zero like a static setting (graph=${graph})`, async () => {
      assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0 adynamicsmooth@sm ${option} ${value}',${smooth}`, graph),
        initial);
      assert.deepEqual(await run(`asetnsamples=4:0,${smooth}:${option}=${value}`, graph), initial);
    });
  }

  it(`adynamicsmooth preserves independent channel histories through repeated updates (graph=${graph})`, async () => {
    const filter = `asetnsamples=4:0,asendcmd=c='0.004 adynamicsmooth@sm basefreq 150;0.008 adynamicsmooth@sm sensitivity 10;0.012 adynamicsmooth@sm basefreq 2',${smooth}`;
    const channels = [input, input.map(sample => -sample)];
    const expected = await Promise.all(channels.map(channel => run(filter, graph, [channel])));
    assert.deepEqual(expected[0], [0, 0, 1, 2, 1095, 3030, 4612, 5887, 7754, 9000, 10000, 11000, 11595, 12504, 13749, 14740]);
    const output = await run(filter, graph, channels);
    assert.deepEqual(output, input.flatMap((_, i) => expected.map(channel => channel[i]!)));
  });
}

it("adynamicsmooth routes commands to the first matching filter or named instance", async () => {
  const first = "adynamicsmooth@first=0:2";
  assert.deepEqual(await run(`asendcmd=c='0 adynamicsmooth basefreq 150',${first},${smooth}`),
    await run(`${first}:basefreq=150,${smooth}`));
  assert.deepEqual(await run(`asendcmd=c='0 adynamicsmooth@sm sensitivity 10',${first},${smooth}`),
    await run(`${first},${smooth}:sensitivity=10`));
  assert.deepEqual(await run(`asendcmd=c='0 adynamicsmooth@missing sensitivity 10',${smooth}`), await run(smooth));
});

it("adynamicsmooth applies updates at the next frame boundary and respects shifted timestamps", async () => {
  const expected = await run(`asetnsamples=4:0,asendcmd=c='0.008 adynamicsmooth@sm basefreq 150',${smooth}`);
  assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.005 adynamicsmooth@sm basefreq 150',${smooth}`), expected);
  assert.deepEqual(await run(`asetnsamples=4:0,asetpts=PTS+1/TB,asendcmd=c='1.008 adynamicsmooth@sm basefreq 150',${smooth}`), expected);
  assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.016 adynamicsmooth@sm basefreq 150',${smooth}`), await run(smooth));
});

it("adynamicsmooth ignores invalid updates and still applies later valid commands", async () => {
  const expected = await run(`asetnsamples=4:0,asendcmd=c='0.008 adynamicsmooth@sm basefreq 150',${smooth}`);
  for (const command of ["basefreq 1", "basefreq 1000001", "sensitivity -1", "sensitivity 1000001", "basefreq NaN", "sensitivity invalid", "unknown 10"]) {
    assert.deepEqual(await run(`asetnsamples=4:0,asendcmd=c='0.004 adynamicsmooth@sm ${command};0.008 adynamicsmooth@sm basefreq 150',${smooth}`), expected);
  }
});
