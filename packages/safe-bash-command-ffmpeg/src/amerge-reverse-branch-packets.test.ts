import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, format: string, select = false) {
  const input = Buffer.alloc(23 * 4);
  for (let sample = 0; sample < 23; sample++) {
    for (let channel = 0; channel < 2; channel++) {
      input.writeInt16LE(sample * 601 + channel * 97 - 5000, sample * 4 + channel * 2);
    }
  }
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      "-filter_complex", `[0:a]asplit=2[a][b];[a]areverse[ra];[b]${filter}[tb];`
        + `[ra][tb]amerge${select ? ",aselect=eq(n\\,1)" : ""}[out]`,
      "-map", "[out]", "-c:a", "pcm_s16le", "-f", format, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(chunks);
}

// Native FFmpeg 7.0.2: filters after the split schedule their own output packets,
// even when the reversed branch drains the shared input first.
for (const [filter, packets, bytes, hash, delays] of [
  ["asetnsamples=n=7:p=0", [
    "0,0,0,7,56,0x04d51c2a", "0,7,7,7,56,0x7eb61428",
    "0,14,14,7,56,0x3d0d1c2a", "0,21,21,2,16,0x4cc2080c"
  ], 56, "0494d256c8bb6da8b5210fcce3cd682ba1282be9e313d9d961d60edf629f5f42", [0, 0]],
  ["adelay=2S|4S", ["0,0,0,2,16,0x14bf0203", "0,2,2,21,168,0x65b94f0d"],
    168, "058aa6c556e14e9c0d4957a3311ed18907c9348af4d213662b3eb6cc27d47c7d", [2, 4]]
] as const) {
  it(`amerge retains packet clocks and checksums after first-branch reversal and ${filter}`, async () => {
    const output = await run(filter, "framecrc");
    assert.deepEqual(output.toString().split("\n").filter(line => line && !line.startsWith("#"))
      .map(line => line.split(",").map(field => field.trim()).join(",")), packets);
  });

  it(`amerge selects the second packet after first-branch reversal and ${filter}`, async () => {
    const output = await run(filter, "s16le", true);
    assert.equal(output.length, bytes);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });

  it(`amerge preserves all PCM samples after first-branch reversal and ${filter}`, async () => {
    const output = await run(filter, "s16le");
    const expected = Array.from({ length: 23 }, (_, sample) => [
      ...[0, 1].map(channel => (22 - sample) * 601 + channel * 97 - 5000),
      ...delays.map((delay, channel) => sample < delay ? 0 : (sample - delay) * 601 + channel * 97 - 5000)
    ]).flat();
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}
