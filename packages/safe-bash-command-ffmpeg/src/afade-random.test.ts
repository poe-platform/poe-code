import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: mono PCM16 at 8 kHz, 8192 samples of 12001 + i % 100.
const input = Buffer.alloc(8192 * 2);
for (let i = 0; i < 8192; i++) input.writeInt16LE(12001 + i % 100, i * 2);

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.pcm": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
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
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const output = Buffer.concat(chunks);
  assert.equal(output.length, input.length);
  return output;
}

for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ["afade=ns=8192:enable=0", "dde55dc63d49b620352dc80a3b97b0f289fef4ba5a6ac2668b2d7232aa56e343"],
    ["afade=ns=8192:enable=1", "b7dee405a10d1c093723243de736a02972c189a4c403f1f100689cfbaf155b02"],
    ["afade=ns=8192:enable=random(0)", "b5fdbdaa71d31e0147827bf466987e0e741cff864c6408fea720fd7497a5070f"],
    ["afade=ns=8192:enable='randomi(0,0,1)'", "b5fdbdaa71d31e0147827bf466987e0e741cff864c6408fea720fd7497a5070f"],
    ["afade@a=ns=8192", "b7dee405a10d1c093723243de736a02972c189a4c403f1f100689cfbaf155b02"],
    ["asendcmd=c='0.25 afade@a enable random(0)',afade@a=ns=8192", "3d3ceea288f3738156b374f8afbbc4688c16df21b99a7a251e499f01acca9bae"]
  ] as const) {
    it(`${filter} matches native PCM on fresh runs (graph ${graph})`, async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const output = await run(filter, graph);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
    });
  }

  // With 2048-sample frames, FFmpeg's two evaluations enable frames 0 and 3.
  for (const [filter, expected] of [
    ["asendcmd=c='0.512 afade enable random(0)',afade=ns=8192:enable=random(0)", "afade=ns=8192:enable='eq(n,0)+eq(n,2)'"],
    ["asendcmd=c='0.512 afade enable invalid',afade=ns=8192:enable=random(0)", "afade=ns=8192:enable='eq(n,0)+eq(n,3)'"],
    ["afade=ns=8192:enable=random(0),afade=ns=8192:enable=random(0)", "afade=ns=8192:enable='eq(n,0)+eq(n,3)',afade=ns=8192:enable='eq(n,0)+eq(n,3)'"],
    ["afade=ns=8192:enable='st(0,0);random(0)'", "afade=ns=8192:enable=0"]
  ] as const) {
    it(`preserves random state across frames: ${filter} (graph ${graph})`, async () => {
      assert.deepEqual(await run(`asetnsamples=2048:0,${filter}`, graph),
        await run(`asetnsamples=2048:0,${expected}`, graph));
    });
  }
}
