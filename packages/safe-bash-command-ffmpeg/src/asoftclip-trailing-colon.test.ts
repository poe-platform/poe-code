import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 s16le output for the 32 PCM16 input samples below.
for (const [options, hash] of [
  ["oversample=2", "4752a2c4d51063b4abc0fe47a7859678e08648ee4bb59a09f64f1b8a78938040"],
  ["hard:0.5:1:1:2", "9fd1fa9608e7b55b1f14d843d326fc8d7ab9b3677238d0e56e23de79bad3d70b"]
] as const) for (const suffix of ["", ":"]) for (const graph of [false, true]) {
  it(`asoftclip=${options}${suffix} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, pcm } = await run(options + suffix, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(pcm.length, 64);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}

for (const options of [":", "oversample=2::", "hard::1:1:2:", "oversample=:"]) {
  for (const graph of [false, true]) {
    it(`asoftclip still rejects empty options in ${options} (${graph ? "graph" : "simple"})`, async () => {
      const { result, stderr, pcm } = await run(options, graph);
      assert.equal(result.exitCode, 234, stderr);
      assert.equal(pcm.length, 0);
    });
  }
}

async function run(options: string, graph: boolean) {
  const input = Buffer.alloc(64);
  for (let i = 0; i < 32; i++) input.writeInt16LE((i * 1751) % 42001 - 21000, i * 2);
  const fs = Volume.fromJSON({ "/in.raw": input });
  const output: Uint8Array[] = [];
  let stderr = "";
  const filter = `asoftclip=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, pcm: Buffer.concat(output) };
}
