import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const channels = [[12001, 0, 10000, 30000, -30000, 5], [0, -24003, -10000, 30000, -30000, 6]];
const mono = [6001, -12001, 0, 30000, -30000, 6];
const stereo = channels[0]!.flatMap((sample, i) => [sample, channels[1]![i]!]);

async function convert(filter: string, graph = false, options: string[] = []) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: channels.map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      ...options, "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  const output = volume.readFileSync("/out.raw") as Buffer;
  return { ...result, stderr, output,
    samples: Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)) };
}

// Entire PCM output from native FFmpeg 7.0.2, including signed half-sample rounding.
for (const key of ["ochl", "out_chlayout"]) {
  for (const rate of ["", "8000:"]) {
    for (const graph of [false, true]) {
      it(`mixes aresample=${rate}${key}=mono (${graph ? "graph" : "simple"})`, async () => {
        const result = await convert(`aresample=${rate}${key}=mono`, graph);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(result.samples, mono);
      });
    }
  }
  for (const value of ["", "bad", "mono|stereo", "mono=1"]) {
    it(`rejects ${key}=${value} without replacing output`, async () => {
      const result = await convert(`aresample=${key}=${value}`);
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.output.toString(), "KEEP");
      assert.ok(result.stderr.includes("channel layout"), result.stderr);
    });
  }
}

for (const [filter, expected] of [
  ["aresample=8000", stereo],
  ["aformat=channel_layouts=mono", mono],
  ["aresample=ochl=mono:out_chlayout=stereo", stereo],
  ["aresample=out_chlayout=stereo:ochl=mono", mono],
  ["aresample=ochl=mono,pan=stereo|c0=c0|c1=c0", mono.flatMap(sample => [sample, sample])]
] as const) {
  it(`preserves controls and filter order: ${filter}`, async () => {
    const result = await convert(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.samples, expected);
  });
}

it("allows explicit layout conversion when automatic conversion is disabled", async () => {
  const result = await convert("aresample=ochl=mono", false, ["-noauto_conversion_filters"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.samples, mono);
});

for (const [format, expected] of [
  ["flt", [8486, -16973, 0, 32767, -32768, 8]],
  ["dbl", [8486, -16973, 0, 32767, -32768, 8]],
  ["s32", [6000, -12002, 0, 30000, -30000, 5]]
] as const) {
  it(`mixes in the requested ${format} format regardless of option order`, async () => {
    for (const options of [`ochl=mono:osf=${format}`, `osf=${format}:out_chlayout=mono`]) {
      const result = await convert(`aresample=${options}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.samples, expected);
    }
  });
}

for (const [filter, expected] of [
  ["aresample=ochl=quad", channels[0]!.flatMap((sample, i) => [sample, channels[1]![i]!, 0, 0])],
  ["aresample=out_chlayout=5.1", channels[0]!.flatMap((sample, i) => [sample, channels[1]![i]!, 0, 0, 0, 0])],
  ["aresample=ochl=mono:first_pts=-16", [...Array<number>(16).fill(0), ...mono]],
  ["aresample=ochl=mono:osr=8000", mono],
  ["aresample=ochl=mono,aresample=ochl=stereo", [4243, -8486, 0, 21213, -21213, 4].flatMap(sample => [sample, sample])]
] as const) {
  it(`matches native layout conversion: ${filter}`, async () => {
    const result = await convert(filter);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.samples, expected);
  });
}
