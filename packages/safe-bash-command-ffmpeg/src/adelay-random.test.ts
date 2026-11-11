import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(4096 * 4);
for (let i = 0; i < 4096; i++) {
  input.writeInt16LE(100 + i, i * 4);
  input.writeInt16LE(2000 + i, i * 4 + 2);
}

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.pcm": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.pcm",
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
  return { output: Buffer.concat(chunks), stderr };
}

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2, including common silence and the complete EOF tail.
  for (const [filter, hash, diagnostic] of [
    ["adelay=2S|5S", "265b05abe643b6c6e3766ecbd9cd3d0c165ef05c4e4b3fee948fed090c769b61", ""],
    ["adelay=2S|5S:enable=0", "6c7637d1b8b9f16b342950ee100063a1abaa5ece30f0e21bf1db2d602e39bf7e", "3584 >= 2"],
    ["adelay=2S|5S:enable=random(0)", "42065d5b845ade7c0c6c95278a100d06c90e43d43f5cd14130ed54c625d161b6", ""],
    ["adelay=2S|5S:enable='randomi(0,0,1)'", "42065d5b845ade7c0c6c95278a100d06c90e43d43f5cd14130ed54c625d161b6", ""],
    ["asendcmd=c='0.125 adelay@a enable random(0)',adelay@a=2S|5S", "7af87495ff893fff8492e336e38ea10d5b974fafc23c2ee332754462007e0c0b", "3584 >= 2048"],
    ["asendcmd=c='0.125 adelay@a enable randomi(0,0,1)',adelay@a=2S|5S", "7af87495ff893fff8492e336e38ea10d5b974fafc23c2ee332754462007e0c0b", "3584 >= 2048"]
  ] as const) {
    it(`${filter} matches native PCM on fresh runs (graph ${graph})`, async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const { output, stderr } = await run(filter, graph);
        assert.equal(output.length, 4101 * 4);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
        if (diagnostic) assert.ok(stderr.includes(diagnostic), stderr);
        else assert.equal(stderr, "");
      }
    });
  }

  // One evaluation per input frame enables frames 1, 6 and 7 of the first eight.
  for (const [filter, reference] of [
    ["asendcmd=c='0.256 adelay enable random(0)',adelay=2S|5S:enable=random(0)", "adelay=2S|5S:enable='eq(n,1)+eq(n,5)'"],
    ["asendcmd=c='0.256 adelay enable random(0)+invalid',adelay=2S|5S:enable=random(0)", "adelay=2S|5S:enable='eq(n,1)+gte(n,6)'"],
    ["adelay=0S|0S:enable=random(0),adelay=2S|5S:enable=random(0)", "adelay=2S|5S:enable='eq(n,1)+gte(n,6)'"],
    ["adelay=2S|5S:enable='st(0,0);random(0)'", "adelay=2S|5S:enable=0"]
  ] as const) {
    it(`preserves random state per expression: ${filter} (graph ${graph})`, async () => {
      assert.deepEqual(await run(`asetnsamples=512:0,${filter}`, graph),
        await run(`asetnsamples=512:0,${reference}`, graph));
    });
  }
}
