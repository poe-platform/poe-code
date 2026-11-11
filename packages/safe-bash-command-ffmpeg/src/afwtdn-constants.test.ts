import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(encodeWav({ sampleRate: 8000,
  channels: [Float64Array.from({ length: 1200 }, (_, i) => ((i * 13129) % 30001 - 15000) / 32768)] }));
const base = "afwtdn=samples=512:levels=2:wavet=sym2:sigma=0.1";

async function run(filter: string, graph = false) {
  const fs = Volume.fromJSON({ "/in.wav": input, "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, pcm: fs.readFileSync("/out.pcm") };
}

// Native FFmpeg 7.0.2 s16le output for the deterministic PCM16 input above.
for (const [option, hash] of [
  ["percent=default", "2f2ba9f7bee86dd971296640edace24e1665063b4b55e640804c503b7b4de795"],
  ["percent=max", "455d9e5f0c198c2f6e1784a0a2563bf07a095f99754921f831bace25f010bfee"],
  ["softness=PI", "d1aae8aeffaf69ca90d79ca36dc4c2bbd69ba80a6f553f93e53c0a2f2b1f71a9"]
]) for (const graph of [false, true]) it(`afwtdn matches native ${option} (graph=${graph})`, async () => {
  const { result, stderr, pcm } = await run(`${base}:${option}`, graph);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(pcm.length, 3054);
  assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
});

for (const [expression, numeric] of [
  ["sigma=default", "sigma=0"],
  ["sigma=min", "sigma=0"],
  ["sigma=max/10", "sigma=0.1"],
  ["levels=default", "levels=10"],
  ["levels=min+1", "levels=2"],
  ["levels=max", "levels=12"],
  ["wavet=default", "wavet=sym10"],
  ["wavet=min", "wavet=sym2"],
  ["wavet=max", "wavet=bl3"],
  ["wavet=sym4-1", "wavet=sym2"],
  ["percent=min", "percent=0"],
  ["percent=10:percent=default", "percent=85"],
  ["samples=default", "samples=8192"],
  ["samples=min", "samples=512"],
  ["samples=max/128", "samples=512"],
  ["softness=default", "softness=1"],
  ["softness=min", "softness=0"],
  ["softness=max", "softness=10"],
  ["softness=E", "softness=2.718281828459045"],
  ["softness=PHI", "softness=1.618033988749895"]
]) it(`afwtdn evaluates ${expression} like ${numeric}`, async () => {
  const actual = await run(`${base}:${expression}`);
  const expected = await run(`${base}:${numeric}`);
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.equal(expected.result.exitCode, 0, expected.stderr);
  assert.deepEqual(actual.pcm, expected.pcm);
});

it("afwtdn accepts positional option constants", async () => {
  const actual = await run("afwtdn=0.1:min+1:sym2:default:0:0:min:PI");
  const expected = await run(`${base}:softness=3.141592653589793`);
  assert.equal(actual.result.exitCode, 0, actual.stderr);
  assert.equal(expected.result.exitCode, 0, expected.stderr);
  assert.deepEqual(actual.pcm, expected.pcm);
});

for (const option of ["percent=max+1", "samples=min-1", "softness=unknown", "profile=default", "adaptive=PI"])
  it(`afwtdn rejects ${option} without replacing output`, async () => {
    const { result, stderr, pcm } = await run(`${base}:${option}`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("afwtdn:"), stderr);
    assert.equal(pcm.toString(), "KEEP");
  });
