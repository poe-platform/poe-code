import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static, Linux x86-64: 384 stereo frames at 1 kHz.
const input = Buffer.alloc(768 * 2);
for (let i = 0; i < 768; i++) input.writeInt16LE(i * 1371 % 60001 - 30000, i * 2);

for (const [filter, format, length, hash] of [
  ["aformat=dblp,aresample=2000", "f64le", 12288, "0e2253351e090d5e32d29602a2de76833b8b917887540abd1c46be0d8e1628a9"],
  ["flanger,aresample=2000", "f64le", 12288, "52001773156af032d5d0cd253b4f6b066cd5098585a167a3fb13b417a21af05f"],
  ["aresample=2000", "f64le", 12288, "baddce618741023ea09d2c84c11be4eb28b400e64ad9b7b16f730b4ca00b7925"],
  ["flanger", "f64le", 6144, "e029c8d090ae89080f3b2bb146c127c83d8687ccad0f349b7f48e69393947c74"],
  ["flanger,aresample=2000", "s16le", 3072, "8341bc968507dd6bdd91424adaafba77e5698f3ae3f723cb2113043bb7924823"]
] as const) {
  for (const graph of [false, true]) it(`matches native ${filter} to ${format} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.pcm", input);
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.pcm",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "pipe:1"],
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
    assert.equal(output.length, length);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
