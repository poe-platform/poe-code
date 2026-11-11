import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 output for 384 stereo frames at 1 kHz.
for (const graph of [false, true]) {
  for (const [options, hash] of [
    ["width=40", "4344cae4a6efdbabfa8ecb471bc17a64bfb0384960a39ff189865e32fa6b22a4"],
    ["width='randomi(0,40,40)'", "4344cae4a6efdbabfa8ecb471bc17a64bfb0384960a39ff189865e32fa6b22a4"],
    ["width='40+random(0)'", "155900670ff944788bfc1294234809d8c493d234e4be706c2b1d102a989dd33c"],
    ["width='40+random(0)':width='40+random(0)'", "155900670ff944788bfc1294234809d8c493d234e4be706c2b1d102a989dd33c"],
    ["width='st(0,42)':width='40+random(0)'", "155900670ff944788bfc1294234809d8c493d234e4be706c2b1d102a989dd33c"],
    ["width='40+random(0)':depth='2+random(0)*0'", "155900670ff944788bfc1294234809d8c493d234e4be706c2b1d102a989dd33c"],
    ["0:2:0:'40+random(0)'", "155900670ff944788bfc1294234809d8c493d234e4be706c2b1d102a989dd33c"]
  ] as const) {
    it(`flanger ${options} matches native PCM (graph=${graph})`, async () => {
      const { fs, result, stderr } = await run(options, graph);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const pcm = fs.readFileSync("/out.pcm") as Buffer;
      assert.equal(pcm.length, 1536);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    });
  }

  for (const [expression, exitCode] of [
    ["random(0,1)", 234], ["randomi(0,40)", 234], ["randomi(0,101,101)", 222]
  ] as const) {
    it(`rejects flanger width=${expression} and preserves output (graph=${graph})`, async () => {
      const { fs, result, stderr } = await run(`width='${expression}'`, graph);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(fs.readFileSync("/out.pcm", "utf8"), "keep");
    });
  }
}

async function run(options: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  const input = Buffer.alloc(1536);
  for (let i = 0; i < 768; i++) input.writeInt16LE(i * 1371 % 60001 - 30000, i * 2);
  fs.writeFileSync("/in.pcm", input);
  const filter = `flanger=${options}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.pcm", ...(graph
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
  return { fs, result, stderr };
}
