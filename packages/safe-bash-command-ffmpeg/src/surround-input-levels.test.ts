import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph: boolean, output = "pipe:1") {
  const input = Buffer.alloc(1536 * 4);
  for (let i = 0; i < 1536; i++) {
    input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
    input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600
      + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
  }
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  fs.writeFileSync("/in.raw", input);
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, stdout: Buffer.concat(chunks), file: fs.readFileSync("/out.pcm", "utf8") };
}

const surround = "surround=win_size=1024";
// Native FFmpeg 7.0.2 PCM16 hashes for the three-hop stereo fixture above.
for (const [filter, hash] of [
  [surround, "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  [`${surround}:fl_in=0`, "3a5b67714c021fbed375fac846b734b9663b830607bcbe405db0d637885fb023"],
  [`${surround}:fr_in=0`, "a3e7214794618fe832b182cd53246f763a2ac26cf18d9c01ab979bcd3af373fd"],
  [`${surround}:fl_in=1`, "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  [`${surround}:fr_in=1`, "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  [`${surround}:fl_in=0:fr_in=0`, "f7b586904e3678145aa47e4232587c913139cef0102d6d8e9276fc80c35cbad3"],
  [`pan=stereo|c0=0*c0|c1=c1,${surround}`, "3a5b67714c021fbed375fac846b734b9663b830607bcbe405db0d637885fb023"],
  [`pan=stereo|c0=c0|c1=0*c1,${surround}`, "a3e7214794618fe832b182cd53246f763a2ac26cf18d9c01ab979bcd3af373fd"]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native input-level PCM (graph=${graph})`, async () => {
    const { result, stderr, stdout } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout.length, 18432);
    assert.equal(createHash("sha256").update(stdout).digest("hex"), hash);
  });
}

for (const option of ["fl_in", "fr_in"]) for (const graph of [false, true]) {
  for (const [value, level] of [["min", 0], ["default", 1], ["1/2", 0.5], ["2", 2]] as const) {
    it(`surround ${option}=${value} scales input before upmixing (graph=${graph})`, async () => {
      const actual = await run(`${surround}:${option}=${value}`, graph);
      const pan = option === "fl_in" ? `c0=${level}*c0|c1=c1` : `c0=c0|c1=${level}*c1`;
      const expected = await run(`pan=stereo|${pan},${surround}`, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.stdout, expected.stdout);
    });
  }
  it(`surround ${option}=max selects gain ten (graph=${graph})`, async () => {
    const actual = await run(`${surround}:${option}=max`, graph);
    const expected = await run(`${surround}:${option}=10`, graph);
    assert.equal(actual.result.exitCode, 0, actual.stderr);
    assert.equal(expected.result.exitCode, 0, expected.stderr);
    assert.deepEqual(actual.stdout, expected.stdout);
  });
  for (const [value, exitCode] of [["-0.1", 222], ["10.1", 222], ["bad", 234], ["", 234]] as const) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`surround rejects ${option}=${value} without writing output (graph=${graph}, ${output})`, async () => {
        const { result, stderr, stdout, file } = await run(`${surround}:${option}=${value}`, graph, output);
        assert.equal(result.exitCode, exitCode, stderr);
        assert.ok(stderr.includes("surround"), stderr);
        assert.equal(stdout.length, 0);
        assert.equal(file, "keep");
      });
    }
  }
}
