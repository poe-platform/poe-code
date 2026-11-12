import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(2400 * 2);
for (let i = 0; i < 2400; i++) input.writeInt16LE(i * 7919 % 22001 - 11000, i * 2);

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.raw": input });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", "stereo", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
  } as never);
  return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
}

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2 synthesizes the same LFE regardless of the enable result.
  for (const filter of [
    "virtualbass=enable=ld(0)",
    String.raw`virtualbass=enable=st(0\,n)+ld(0)`,
    "virtualbass=enable=random(0)",
    String.raw`virtualbass=enable=randomi(0\,0\,1)`,
    "virtualbass=enable=0",
    "virtualbass=enable=1",
    String.raw`virtualbass=enable=gte(t\,0.064)`,
    "virtualbass"
  ]) {
    it(`${filter} preserves native PCM (graph=${graph})`, async () => {
      const actual = await run(filter, graph);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout.length, 7200);
      assert.equal(createHash("sha256").update(actual.stdout).digest("hex"),
        "8a9b2d61432a352de91e63c3a32eb0dc1a4efabb5491f0a941c153c5246136ce");
    });
  }

  for (const expression of ["ld(0,1)", "st(0)", "random(0,1)", "randomi(0,1)"]) {
    it(`rejects malformed ${expression} without output (graph=${graph})`, async () => {
      const actual = await run(`virtualbass=enable='${expression}'`, graph);
      assert.equal(actual.exitCode, 234, actual.stderr);
      assert.ok(actual.stderr.includes("virtualbass enable: invalid or unsupported expression"), actual.stderr);
      assert.equal(actual.stdout.length, 0);
    });
  }
}
