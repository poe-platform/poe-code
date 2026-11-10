import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { readFileSync } from "node:fs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 9.0.1 s16le reference hashes for the 8 kHz mono PCM16 fixture.
const input = readFileSync(new URL("./fixtures/vibrato-timeline.wav", import.meta.url));

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.wav": input, "/out.pcm": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); } },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out.pcm") as Buffer };
}

for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ["vibrato=enable='gte(t,0.5)'", "482a20d4ad944dd6ece2e45f77409bc759c428f308dbb69d56e2120a36eedbcb"],
    ["vibrato=enable=gte(t\\,0.5)", "482a20d4ad944dd6ece2e45f77409bc759c428f308dbb69d56e2120a36eedbcb"],
    ["vibrato=enable='gte(n,1)'", "456d11ff062a4b322fedac6d03a7d5216cbcc470ebe417b939c7f3d111c53d37"],
    ["vibrato=enable='mod(n,2)'", "d51a74a27a797feb6cbacbb667d57aa8b68371244c6fca776b759dcc11dc88f9"],
    ["asetpts=PTS+4096,vibrato=enable='gte(t,0.5)'", "655e3162c084f689beb0de04bb60f156f73ead69125edf602b35504774904e59"],
    ["asetnsamples=n=128:p=0,vibrato=enable='mod(n,2)'", "451435ea76301ce193ada1fd46a60dcbaff14383dd59032881b80da2e17a91ea"]
  ]) {
    it(`vibrato matches native timeline PCM: ${filter} (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(filter!, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(output.length, 12000 * 2);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (filter === "vibrato=enable='gte(t,0.5)'") {
        const bypass = await run("anull", graph);
        assert.equal(bypass.result.exitCode, 0, bypass.stderr);
        assert.deepEqual(output.subarray(0, 4096 * 2), bypass.output.subarray(0, 4096 * 2));
        assert.notDeepEqual(output.subarray(4096 * 2), bypass.output.subarray(4096 * 2));
      }
    });
  }

  // FFmpeg 7.0.2 reference: newer FFmpeg versions removed the pos variable.
  it(`vibrato uses input packet positions (graph ${graph})`, async () => {
    const { result, stderr, output } = await run("vibrato=enable='gte(pos,4096)'", graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(createHash("sha256").update(output).digest("hex").slice(0, 16), "8f6554bf598b1c3a");
  });

  for (const [enable, expectedFilter] of [
    ["w", "anull"], ["h", "anull"], ["PI", "vibrato"],
    ["E", "vibrato"], ["PHI", "vibrato"],
    ["pos", "vibrato"]
  ]) {
    it(`vibrato exposes native enable variable ${enable} (graph ${graph})`, async () => {
      const expected = await run(expectedFilter!, graph);
      const actual = await run(`vibrato=enable='${enable}'`, graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const enable of ["0", "0.25", "1", "-1"]) {
    it(`vibrato enable=${enable} matches constant gating (graph ${graph})`, async () => {
      const expected = await run(Math.abs(Number(enable)) >= 0.5 ? "vibrato" : "anull", graph);
      const actual = await run(`vibrato=enable=${enable}`, graph);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.deepEqual(actual.output, expected.output);
    });
  }

  for (const enable of ["", "unknown", "gte(t)", "1+"]) {
    it(`rejects invalid vibrato enable=${enable} without replacing output (graph ${graph})`, async () => {
      const { result, stderr, output } = await run(`vibrato=enable=${enable}`, graph);
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("vibrato"), stderr);
      assert.equal(output.toString(), "KEEP");
    });
  }
}
