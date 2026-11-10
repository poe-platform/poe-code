import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 references: a 256-sample mono PCM16 impulse at 8 kHz.
for (const graph of [false, true]) {
  for (const [filter, frames, impulses] of [
    ["anull", 256, [[0, 16000]]],
    ["chorus=0.5:0.9:10:0.5:1:1", 344, [[0, 7200], [4, 7200]]],
    ["chorus=0.5:0.9:10:0.5:1:1:", 344, [[0, 7200], [4, 7200]]],
    ["chorus=in_gain=0.5:out_gain=0.9:delays=10:decays=0.5:speeds=1:depths=1:", 344, [[0, 7200], [4, 7200]]],
    ["chorus=default:max:10:0.5:1:1", 344, [[0, 6400], [4, 8000]]],
    ["chorus=max:default:10:0.5:1:1", 344, [[0, 6400], [4, 3200]]],
    ["chorus=min:max:10:0.5:1:1", 344, [[4, 8000]]],
    ["chorus=max:min:10:0.5:1:1", 344, []],
    ["chorus=in_gain=1:in_gain=default:out_gain=0:out_gain=max:delays=10:decays=0.5:speeds=1:depths=1", 344, [[0, 6400], [4, 8000]]],
    ["chorus=max/2:default+0.5:10:0.5:1:1", 344, [[0, 7200], [4, 7200]]],
    ["chorus=0.5:0.9:0xa:0x.8:0x1:0x1", 344, [[0, 7200], [4, 7200]]],
    ["chorus=0.5:0.9:10|20:0.5|0.3:1|2:1|2", 432, [[0, 7200], [4, 7200], [8, 4320]]],
    ["chorus=in_gain=0.5:out_gain=0.9:delays=10|20:decays=0.5|0.3:speeds=1|2:depths=1|2", 432, [[0, 7200], [4, 7200], [8, 4320]]],
    ["chorus=0.5:0.9:10:0.5:1:1,volume=0.5", 344, [[0, 3600], [4, 3600]]],
    ["chorus=0.5:0.9:10:0.5:1:1,atrim=start_sample=4", 340, [[0, 7200]]]
  ] as const) {
    it(`${filter} matches native samples and duration (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(filter, graph);
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc(frames * 2);
      for (const [frame, value] of impulses) expected.writeInt16LE(value, frame * 2);
      assert.deepEqual(output, expected);
    });
  }
}

// Native FFmpeg 7.0.2 stereo PCM hashes cover modulation across input frames,
// oscillator wraparound, zero-depth taps, floating-point rounding and clipping.
for (const [filter, frames, hash] of [
  ["chorus=0.5:0.9:10|20:0.5|0.3:1|2:1|2", 4272, "b4fd1621d516090cd9970bdf8b718ff72076b5c89402c7fded04469d13e8c7e1"],
  ["chorus=0.5:0.9:10:0.5:1:0", 4176, "f3428c3abe80d677d3589427d4e1948f421e5a21b0fa93a2b7fe9a1e990e5553"],
  ["chorus=delays=10:decays=0.5:speeds=7.3:depths=1.7", 4189, "591b27d560828099e6d88ff1130b9eb6a3311a0fad90f78f250bf389a8342819"],
  ["chorus=1:1:300|400:0.7|0.8:3|5:3|7", 7352, "65142dca1f5d33685fb25fa79b20c8455091f977be4e811acd9d9a844e918088"]
] as const) {
  it(`${filter} matches native stereo PCM across frames`, async () => {
    const channels = [
      Float64Array.from({ length: 4096 }, (_, i) => ((i * 997) % 64000 - 32000) / 32768),
      Float64Array.from({ length: 4096 }, (_, i) => (32000 - (i * 829) % 64000) / 32768)
    ];
    const { result, stderr, output } = await run(filter, false, channels);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, frames * 4);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

// Native FFmpeg 7.0.2: hexadecimal delays must preserve every PCM sample and the EOF tail.
for (const delay of ["0x10", "16", "+0X10", "0x1p4", "0x.8p5", "16ms"]) {
  for (const graph of [false, true]) {
    it(`chorus delay ${delay} matches native mono PCM (graph ${graph})`, async () => {
      const channels = [Float64Array.from({ length: 4096 }, (_, i) => ((i * 179) % 50001 - 25000) / 32768)];
      const { result, stderr, output } = await run(`chorus=0.4:0.4:${delay}:0.3:2:4`, graph, channels);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 8512);
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "77e70c40a35fa1574b04320e9542a68c0a01a8dfee27195a45e7f904da451dda");
    });
  }
}

it("chorus emits delayed samples after EOF independently for each channel", async () => {
  const channels = [new Float64Array(2), new Float64Array(2)];
  channels[0]![0] = 16000 / 32768;
  channels[1]![1] = -8000 / 32768;
  const { result, stderr, output } = await run("chorus=0.5:0.9:10:0.5:1:1", false, channels);
  assert.equal(result.exitCode, 0, stderr);
  const expected = Buffer.alloc(90 * 4);
  expected.writeInt16LE(7200, 0);
  expected.writeInt16LE(-3600, 6);
  expected.writeInt16LE(7200, 16);
  expected.writeInt16LE(-3600, 22);
  assert.deepEqual(output, expected);
});

it("chorus exposes its complete tail to downstream frame filters", async () => {
  const { result, stderr, output } = await run("chorus=0.5:0.9:10:0.5:1:1,aselect='gte(n,1)'");
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(output, Buffer.alloc(88 * 2));
});

for (const filter of [
  "chorus", "chorus=0.5:0.9:10:0.5:1", "chorus=0.5:0.9:10|20:0.5:1:1",
  "chorus=0.5:0.9:10:0.5:0:1", "chorus=0.5:0.9:10:0.5:Infinity:1",
  "chorus=0.5:0.9:-10:0.5:1:1", "chorus=0.5:0.9:-0x10:0.5:1:1", "chorus=0.5:0.9:10:0.5:1:-1",
  "chorus=0.5:0.9:10:0.5:1:Infinity", "chorus=2:0.9:10:0.5:1:1",
  "chorus=max+1:default:10:0.5:1:1", "chorus=default:min-1:10:0.5:1:1",
  "chorus=default/0:max:10:0.5:1:1", "chorus=default:unknown:10:0.5:1:1",
  "chorus=0.5:0.9:10:0.5:1:1:unknown=1", "chorus=0.5:0.9:2000:0.5:1:1"
]) {
  it(`${filter} fails without replacing output`, async () => {
    const { result, output } = await run(filter);
    assert.equal(result.exitCode, 1);
    assert.equal(output.toString(), "keep");
  });
}

for (const graph of [false, true]) {
  for (const suffix of ["unknown=1", "unknown=1:"]) {
    it(`chorus rejects ${suffix} without replacing output (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(`chorus=0.5:0.9:10:0.5:1:1:${suffix}`, graph);
      assert.equal(result.exitCode, 1);
      assert.equal(stderr, "ffmpeg: chorus: unsupported option unknown\n");
      assert.equal(output.toString(), "keep");
    });
  }
}

async function run(filter: string, graph = false, channels?: Float64Array[]) {
  if (!channels) {
    channels = [new Float64Array(256)];
    channels[0]![0] = 16000 / 32768;
  }
  const volume = Volume.fromJSON({ "/out.s16": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
  let stderr = "";
  const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 2 } }).execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-c:a", "pcm_s16le", "-f", "s16le", "/out.s16"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.s16") as Buffer };
}
