import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph = false, samples = 32) {
  const fs = createMemoryFileSystem();
  const input = Buffer.alloc(44 + samples * 4);
  input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
  input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(2, 22);
  input.writeUInt32LE(48000, 24); input.writeUInt32LE(192000, 28);
  input.writeUInt16LE(4, 32); input.writeUInt16LE(16, 34); input.write("data", 36);
  input.writeUInt32LE(samples * 4, 40);
  await fs.writeFile("/in.wav", input);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
      "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  return { result, stderr, output: Buffer.concat(chunks) };
}

for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ["anull", "5341e6b2646979a70e57653007a1f310169421ec9bdd9f1a5648f75ade005af1"],
    ["adenorm=level=-120:type=dc", "8f952e39752225ee36c9a291ed2f595ab95055d6e52c2de0df19d5fa062909f7"],
    ["adenorm=level=-120:type=ac", "397a0ac88d7ea8f379b34d128a6f4acc8a588c1317d11745eb9c6b23b5ca9ebf"]
  ]) {
    it(`matches native ${filter}, graph=${graph}`, async () => {
      const { result, stderr, output } = await run(filter!, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 256);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}

it("keeps AC channels in phase across odd-sized frames", async () => {
  const { result, stderr, output } = await run("asetnsamples=n=3:p=0,adenorm@noise=-120:ac", false, 2051);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(output.length, 2051 * 8);
  for (let i = 0; i < 2051; i++) {
    assert.equal(output.readFloatLE(i * 8), Math.fround(i % 2 ? -1e-6 : 1e-6));
    assert.equal(output.readFloatLE(i * 8 + 4), output.readFloatLE(i * 8));
  }
});

for (const options of ["level=-452", "level=-89", "type=unknown", "unknown=1"]) {
  it(`rejects adenorm ${options}`, async () => {
    const { result, output } = await run(`adenorm=${options}`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.length, 0);
  });
}

for (const [type, hash] of [
  ["square", "7d2986f842fe8c998c9c919b1fc112ea454cfb2f222c629ed30370c79dd805d7"],
  ["2", "7d2986f842fe8c998c9c919b1fc112ea454cfb2f222c629ed30370c79dd805d7"],
  ["pulse", "c05b8d3896e2fc45c9dd28914cb2e50a7d4fedacd75451a354d54f808ed90d8b"],
  ["3", "c05b8d3896e2fc45c9dd28914cb2e50a7d4fedacd75451a354d54f808ed90d8b"],
  ["dc", "6f42824148278a31f3efe6e470dbba2e622d6cfc91d4133f7873640291f8da79"],
  ["ac", "d4f740f28c691bffa32f9b79e808a82b922b2331d3bb85186331c19d15e768a8"]
]) {
  it(`matches native ${type} across 8-sample frames`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.raw", Buffer.alloc(1056));
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=8:p=0,adenorm@a=level=-120:type=${type}`, "-f", "f32le", "pipe:1"],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write(chunk) { chunks.push(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const output = Buffer.concat(chunks);
    assert.equal(output.length, 2112);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const type of ["square", "pulse"]) {
  it(`keeps positional ${type} channels in phase in a filter graph`, async () => {
    const { result, stderr, output } = await run(`asetnsamples=n=8:p=0,adenorm=-120:${type}`, true, 528);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(output.length, 528 * 8);
    for (let i = 0; i < 528; i++) {
      const noise = type === "square" ? (Math.floor(i / 256) % 2 ? -1e-6 : 1e-6) : (i % 256 ? 0 : 1e-6);
      assert.equal(output.readFloatLE(i * 8), Math.fround(noise));
      assert.equal(output.readFloatLE(i * 8 + 4), Math.fround(noise));
    }
  });
}
