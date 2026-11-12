import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(enable: string, graph: boolean, prefix = "", channels = 1) {
  const input = Buffer.alloc(67 * channels * 2);
  for (let i = 0; i < 67; i++) for (let c = 0; c < channels; c++) {
    input.writeInt16LE([0, 4000, 0, -4000][i % 4]!, (i * channels + c) * 2);
  }
  const fs = Volume.fromJSON({ "/in.raw": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const filter = `${prefix}afftfilt=win_size=16:overlap=0.5:real=0:imag=0:enable=${enable.replaceAll(",", "\\,")}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: Buffer.concat(chunks) };
}

// Native FFmpeg 7.0.2: 67 mono PCM16 samples at 8 kHz, repeating 0,4000,0,-4000.
for (const [enable, sha256] of [
  ["0", "bfb61601851ca1e177f536cb63c0c25fd970e2f5e82d5d4d24411153137c2e9d"],
  ["1", "e7e7ba7c94c2574ab9e0d47a90f4660dd0b83d4a935141568c8bfc1024ec87cb"],
  ["gte(t,0.004)", "ebb39208aff117576df0f01bed86daf75541a68e66107a87309666e54823b141"],
  ["lt(t,0.004)", "8df3953920548cfa176f4cde6c9c426581786f73f2a13605710be9a0458d824f"],
  ["gte(n,4)", "ebb39208aff117576df0f01bed86daf75541a68e66107a87309666e54823b141"],
  ["mod(st(0,ld(0)+1),2)", "08d0c5d82281ed2120aad10e43c0ec97cbe1fa20f43d7256ec2dc6ed744b8452"],
  ["0.4", "bfb61601851ca1e177f536cb63c0c25fd970e2f5e82d5d4d24411153137c2e9d"],
  ["-0.5", "e7e7ba7c94c2574ab9e0d47a90f4660dd0b83d4a935141568c8bfc1024ec87cb"],
  ["NAN", "bfb61601851ca1e177f536cb63c0c25fd970e2f5e82d5d4d24411153137c2e9d"],
  ["isnan(pos)", "bfb61601851ca1e177f536cb63c0c25fd970e2f5e82d5d4d24411153137c2e9d"]
] as const) for (const graph of [false, true]) {
  it(`matches native afftfilt enable=${enable}, graph=${graph}`, async () => {
    const { result, stderr, output } = await run(enable, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(output.length, 134);
    assert.equal(createHash("sha256").update(output).digest("hex"), sha256);
  });
}

it("evaluates the timeline once per FFT hop across stereo channels", async () => {
  const { result, stderr, output } = await run("mod(st(0,ld(0)+1),2)", false, "", 2);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(output.length, 268);
  const mono = Buffer.alloc(134);
  for (let i = 0; i < 67; i++) {
    assert.equal(output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2));
    mono.writeInt16LE(output.readInt16LE(i * 4), i * 2);
  }
  assert.equal(createHash("sha256").update(mono).digest("hex"),
    "08d0c5d82281ed2120aad10e43c0ec97cbe1fa20f43d7256ec2dc6ed744b8452");
});

it("uses upstream timestamps for afftfilt enable", async () => {
  const { result, stderr, output } = await run("gte(t,1.004)", false, "asetpts=PTS+8000,");
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(output.length, 134);
  assert.equal(createHash("sha256").update(output).digest("hex"),
    "ebb39208aff117576df0f01bed86daf75541a68e66107a87309666e54823b141");
});

it("rejects invalid afftfilt enable expressions before emitting audio", async () => {
  const { result, stderr, output } = await run("unknown", false);
  assert.equal(result.exitCode, 234, stderr);
  assert.ok(stderr.includes("afftfilt"), stderr);
  assert.equal(output.length, 0);
});
