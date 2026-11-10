import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 0, 9000, 9000, 0, 0, 0, 0, 4000, -4000, 0, 0, 0, 0, 0, 0,
  ...Array<number>(11).fill(7000), 0, 0, 0];
const median = [...samples.slice(0, 8), ...samples.slice(10, 14), ...samples.slice(18, 31)];

async function run(filter: string, format = "s16le", graph = false, channels = [samples]) {
  const input = Buffer.alloc(channels[0]!.length * channels.length * 2);
  channels.forEach((channel, c) => channel.forEach((value, i) => input.writeInt16LE(value, (i * channels.length + c) * 2)));
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", String(channels.length), "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", format, "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2, identical signed PCM16 input at 1 kHz.
for (const detection of ["median", "3", "avg"]) for (const graph of [false, true]) {
  for (const format of ["s16le", "framecrc"]) {
    it(`silenceremove detection=${detection} matches native ${format} (graph=${graph})`, async () => {
      const { result, stderr, output } = await run(
        `silenceremove=stop_periods=-1:stop_threshold=0.12:window=5ms:detection=${detection}`, format, graph);
      assert.equal(result.exitCode, 0, stderr);
      if (format === "s16le") {
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          detection === "avg" ? samples.slice(0, 31) : median);
      } else {
        assert.ok(output.toString().includes("#tb 0: 1/1000"));
        const rows = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
          .map(line => line.split(",").map(field => field.trim()));
        assert.deepEqual(rows, [["0", "0", "0", detection === "avg" ? "31" : "25",
          detection === "avg" ? "62" : "50", detection === "avg" ? "0xbce60786" : "0xa5e60786"]]);
      }
    });
  }
}

for (const [options, expected] of [
  ["start_periods=1:start_threshold=0.12:window=5ms", samples.slice(4)],
  ["stop_periods=1:stop_threshold=0.12:window=5ms", samples.slice(0, 8)],
  ["stop_periods=-1:stop_threshold=0.12:window=0", [...samples.slice(0, 6), 4000, -4000, ...samples.slice(18, 29)]],
  ["stop_periods=-1:stop_threshold=0.12:window=2ms", [...samples.slice(0, 6), 4000, -4000, ...samples.slice(18, 29)]],
  ["stop_periods=-1:stop_threshold=0.12:window=100ms", [...samples.slice(0, 8), ...samples.slice(10, 16), ...samples.slice(18)]],
  ["start_periods=1:start_threshold=0.12:stop_periods=-1:stop_threshold=0.12:window=5ms", median.slice(4)]
] as const) {
  it(`matches native median ${options}`, async () => {
    const { result, stderr, output } = await run(`silenceremove=${options}:detection=median`);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}

for (const [options, hash] of [
  ["start_periods=1:start_threshold=0.12:start_mode=any", "eae2ef1df9864f28147f16c5d1ed3097c9901fc09207c0b33b404ed4670c7688"],
  ["start_periods=1:start_threshold=0.12:start_mode=all", "3d779967b7e8b764174e52e6d7b881e51f7f4f1535b85efefbe769c2931896c5"],
  ["stop_periods=-1:stop_threshold=0.12:stop_mode=any", "1d4470db8b5ccb8bc375430ad76895acec7ec2f518c0a8f9bdad5f765b5bb10f"],
  ["stop_periods=-1:stop_threshold=0.12:stop_mode=all", "744c2379b7dd44b95f5607725119a08bf8b98008be9d2e0a71504251afea5a89"]
] as const) {
  it(`matches native stereo median ${options}`, async () => {
    const { result, stderr, output } = await run(`silenceremove=${options}:window=5ms:detection=median`,
      "s16le", false, [samples, samples.map(value => -value).reverse()]);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
