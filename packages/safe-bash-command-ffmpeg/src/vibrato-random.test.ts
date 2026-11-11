import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, mono PCM16 at 8 kHz:
// ffmpeg -v error -f s16le -ar 8000 -ac 1 -i in.pcm -af FILTER -f s16le pipe:1
const input = Buffer.alloc(8192 * 2);
for (let i = 0; i < 8192; i++) input.writeInt16LE(i % 30000 - 15000, i * 2);

async function run(filter: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.pcm": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
      : ["-af", filter]), "-f", "s16le", "pipe:1"],
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
  for (const [enable, hash] of [
    ["0", "6ac93a1df347c68afe4ca50c322575f34cba4e2ee066b992fdfea831894427a3"],
    ["1", "6fa5b8c9f323e6877288b63e322521699ad1ef5bb44ef513edc79e6389d0ce22"],
    ["random(0)", "f763847ffda0a9b9aca85ebcb722ca9445b836b68e0a36152e309f2e2505d0f3"],
    ["randomi(0,0,1)", "f763847ffda0a9b9aca85ebcb722ca9445b836b68e0a36152e309f2e2505d0f3"]
  ]) {
    it(`vibrato enable=${enable} matches native PCM on fresh runs (graph ${graph})`, async () => {
      for (let repeat = 0; repeat < 2; repeat++) {
        const output = await run(`vibrato=enable='${enable}'`, graph);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      }
    });
  }

  for (const [filter, expected] of [
    ["vibrato=enable=random(0)", "vibrato=enable='eq(n,0)+eq(n,3)'"],
    ["asendcmd=c='0.512 vibrato enable random(0)',vibrato=enable=random(0)", "vibrato=enable='eq(n,0)+eq(n,2)'"],
    ["asendcmd=c='0.512 vibrato enable invalid',vibrato=enable=random(0)", "vibrato=enable='eq(n,0)+eq(n,3)'"],
    ["vibrato=enable=random(0),vibrato=enable=random(0)", "vibrato=enable='eq(n,0)+eq(n,3)',vibrato=enable='eq(n,0)+eq(n,3)'"],
    ["vibrato=enable='st(0,0);random(0)'", "vibrato=enable=0"]
  ]) {
    it(`preserves random timeline transitions: ${filter} (graph ${graph})`, async () => {
      const actual = await run(`asetnsamples=2048:0,${filter}`, graph);
      const output = await run(`asetnsamples=2048:0,${expected}`, graph);
      assert.deepEqual(actual, output);
    });
  }

  it(`scheduled vibrato enable accepts a fresh random expression (graph ${graph})`, async () => {
    const expected = await run("vibrato=enable=random(0)", graph);
    const output = await run("asendcmd=c='0 vibrato enable random(0)',vibrato=enable=0", graph);
    assert.deepEqual(output, expected);
  });
}
