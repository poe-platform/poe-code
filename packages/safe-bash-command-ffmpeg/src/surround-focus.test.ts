import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(value: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/out.pcm": "keep" });
  const input = Buffer.alloc(1536 * 4);
  for (let i = 0; i < 1536; i++) {
    input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
    input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600 + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
  }
  fs.writeFileSync("/in.raw", input);
  const filter = `surround=win_size=1024${value ? `:focus=${value}` : ""}`;
  let stderr = "";
  const stdout: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", graph ? "/out.pcm" : "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: graph ? fs.readFileSync("/out.pcm") as Buffer : Buffer.concat(stdout) };
}

// Native FFmpeg 7.0.2 hashes for 1536 stereo PCM16 frames at 8 kHz.
for (const [values, hash] of [
  [["", "0", "default"], "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  [["0.5", "1/2"], "f552675f905e9484b32c4a521117d3ef2c7dc6cd8bb7647df1841e00e4c62b7e"],
  [["-0.5"], "5dca50949984ec01f2ba895bd5ae4160d66b58a69023bac1e700b8a59993dc18"]
] as const) for (const value of values) for (const graph of [false, true]) {
  it(`surround focus=${value || "implicit"} matches native PCM (graph=${graph})`, async () => {
    const { result, stderr, output } = await run(value, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(output.length, 18432);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const [value, status] of [["-1.01", 222], ["1.01", 222], ["bad", 234]] as const) {
  it(`surround rejects focus=${value} without replacing output`, async () => {
    const { result, output } = await run(value, true);
    assert.equal(result.exitCode, status);
    assert.equal(output.toString(), "keep");
  });
}
