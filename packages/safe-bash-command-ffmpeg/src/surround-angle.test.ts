import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(1536 * 4);
for (let i = 0; i < 1536; i++) {
  input.writeInt16LE((i % 128 < 64 ? 1 : -1) * 900, i * 4);
  input.writeInt16LE(((i + 13) % 128 < 64 ? 1 : -1) * 600 + (i % 16 < 8 ? 1 : -1) * 200, i * 4 + 2);
}
async function run(angle: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.raw": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const filter = `surround=win_size=1024${angle ? `:angle=${angle}` : ""}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
      "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(p: string) { return fs.readFileSync(p); },
      async stat(p: string) { return fs.statSync(p); } },
    stdin: (async function* () {})(),
    stdout: { async write(b: Uint8Array) { chunks.push(Buffer.from(b)); } },
    stderr: { async write(b: Uint8Array) { stderr += new TextDecoder().decode(b); } }
  } as never);
  return { result, stderr, output: Buffer.concat(chunks) };
}

// Native FFmpeg 7.0.2 PCM16 references, including the implicit 90-degree control.
for (const [angle, hash] of [
  ["", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["90", "5d4836edd80e965b40d0533891615b540241d1442bf4e4a471e6adaa2ed058da"],
  ["45", "ce104e20ca11be7744f27bd50803e763aceebbc8dda3d53d3b99730bcd51b45f"],
  ["180", "419632d756fbb588898cfefcb5f19af6c07b0689c6611f5eac881a4dec0bd58a"]
]) for (const graph of [false, true]) {
  it(`surround angle=${angle || "implicit"} matches native PCM (graph=${graph})`, async () => {
    const { result, stderr, output } = await run(angle!, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(output.length, 18432);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}

for (const graph of [false, true]) {
  it(`surround angle accepts expressions and constants (graph=${graph})`, async () => {
    for (const [value, angle] of [["min", "0"], ["max", "360"], ["default", "90"], ["180/4", "45"]]) {
      const actual = await run(value!, graph);
      const expected = await run(angle!, graph);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(expected.result.exitCode, 0, expected.stderr);
      assert.deepEqual(actual.output, expected.output);
    }
  });
  for (const [angle, code] of [["-1", 222], ["361", 222], ["bad", 234]] as const) {
    it(`surround rejects angle=${angle} (graph=${graph})`, async () => {
      const { result, output } = await run(angle, graph);
      assert.equal(result.exitCode, code);
      assert.equal(output.length, 0);
    });
  }
}
