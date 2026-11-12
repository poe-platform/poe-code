import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { wavpackAst } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const stereo = Buffer.alloc(256 * 2 * 4);
for (let i = 0; i < 256; i++) for (let ch = 0; ch < 2; ch++) {
  stereo.writeFloatLE((((i * 31337 + ch * 997) % 65536) - 32768) / 32768, (i * 2 + ch) * 4);
}
// Signed zeros, subnormals, differing exponents, and mantissas requiring extra bits.
const bits = [0, 0x80000000, 1, 0x80000001, 0x007fffff, 0x00800000,
  0x3f800001, 0xbeaaaaab, 0x3f7fffff, 0x00800001, 0x40000001, 0xc0400000];
const extra = Buffer.alloc(bits.length * 32 * 4);
for (let i = 0; i < bits.length * 32; i++) extra.writeUInt32LE(bits[i % bits.length]!, i * 4);

// Native FFmpeg: -f f32le -ar 8000 -ac 2 -i input -c:a wavpack output.wv
for (const [name, expected] of [["stereo", stereo], ["extra", extra]] as const) {
  it(`decodes lossless floating-point WavPack ${name} to the exact source PCM`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.wv", readFileSync(new URL(`./fixtures/wavpack-float-${name}.wv`, import.meta.url)));
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wv", "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Buffer.concat(chunks), expected);
  });
}

it("validates float metadata and the extra-bit checksum", () => {
  const input = readFileSync(new URL("./fixtures/wavpack-float-extra.wv", import.meta.url));
  const plugin = wavpackAst();
  let checked = 0;
  for (let pos = 32; pos < input.readUInt32LE(4) + 8;) {
    const id = input[pos++]!;
    let size = input[pos++]! * 2;
    if (id & 0x80) { size += input[pos++]! * 512 + input[pos++]! * 131072; }
    if ((id & 0x3f) === 8) {
      checked++;
      const corrupted = Buffer.from(input);
      corrupted[pos - 2] = 0x28; // Turn required float info into optional metadata.
      assert.throws(() => plugin.parse(corrupted), /WavPack float metadata/);
    }
    if ((id & 0x3f) === 12) {
      checked++;
      const corrupted = Buffer.from(input);
      corrupted[pos] = corrupted[pos]! ^ 1;
      assert.throws(() => plugin.parse(corrupted), /WavPack float checksum mismatch/);
      assert.equal(plugin.parse(corrupted, { decodeAudio: false }).tracks[0]!.decodedAudio, undefined);
    }
    pos += size;
  }
  assert.equal(checked, 2);
});
