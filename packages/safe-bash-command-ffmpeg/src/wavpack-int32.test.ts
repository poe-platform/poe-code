import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { wavpackAst } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

// Encoded and decoded independently with native FFmpeg 7.0.2, at 8000 Hz.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/wavpack-${name}.wv`, import.meta.url));

async function run(bytes: Uint8Array, args: string[]) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wv", bytes);
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wv", ...args, "pipe:1"],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(bytes) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  return { ...result, stdout: Buffer.concat(output), stderr };
}

for (const [bits, channels, frames] of [[16, 2, 256], [24, 2, 256], [32, 2, 256], [32, 1, 256], [32, 2, 529]] as const) {
  it(`decodes ${frames} lossless ${bits}-bit WavPack frames with ${channels} channels exactly`, async () => {
    const bytes = fixture(`int${bits}-${channels === 1 ? "mono" : "stereo"}${frames === 529 ? "-blocks" : ""}`);
    const expected = Buffer.alloc(frames * channels * bits / 8);
    for (let i = 0; i < frames; i++) for (let ch = 0; ch < channels; ch++) {
      const v = ((i * 31337 + ch * 997) % 65536) - 32768;
      const value = bits === 16 ? v : bits === 24 ? v * 255 + 3 : v * 65535 + 3;
      expected.writeIntLE(value, (i * channels + ch) * bits / 8, bits / 8);
    }
    if (frames === 529) [-2147483648, 2147483647, -1, 0, 1, -2147483647].forEach((v, i) => expected.writeInt32LE(v, i * 4));
    const result = await run(bytes, ["-c:a", `pcm_s${bits}le`, "-f", `s${bits}le`]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, expected);
    if (bits === 32 && channels === 2 && frames === 256) {
      assert.equal(createHash("sha256").update(result.stdout).digest("hex"), "fdc7060b2e1865bc2421eaabffcb1679cb2195bbfe0c3d4cd31067ad4f6df1ee");
    }
  });
}

function metadata(bytes: Buffer, id: number) {
  for (let offset = 32; offset < bytes.readUInt32LE(4) + 8;) {
    const start = offset, tag = bytes[offset++]!;
    let size = bytes[offset++]! * 2;
    if (tag & 0x80) { size += bytes[offset++]! * 512 + bytes[offset++]! * 131072; }
    if ((tag & 0x3f) === id) return { start, offset, size };
    offset += size;
  }
  throw new Error(`Missing metadata ${id}`);
}

for (const corrupt of ["checksum", "bits", "missing", "truncated", "width"] as const) {
  it(`rejects ${corrupt} extended integer data without affecting packet copy`, async () => {
    let bytes = fixture("int32-stereo");
    const extra = metadata(bytes, 12);
    if (corrupt === "checksum") bytes[extra.offset] = bytes[extra.offset]! ^ 1;
    if (corrupt === "bits") bytes[extra.offset + 4] = bytes[extra.offset + 4]! ^ 1;
    if (corrupt === "missing") bytes[extra.start] = bytes[extra.start]! | 0x20;
    if (corrupt === "truncated") {
      bytes = Buffer.concat([bytes.subarray(0, extra.start), Buffer.from([12, 2]), bytes.subarray(extra.offset, extra.offset + 4), bytes.subarray(extra.offset + extra.size)]);
      bytes.writeUInt32LE(bytes.readUInt32LE(4) - (extra.offset + extra.size - extra.start - 6), 4);
    }
    if (corrupt === "width") bytes[metadata(bytes, 9).offset] = 32;
    const result = await run(bytes, ["-c:a", "pcm_s32le", "-f", "s32le"]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    const message = corrupt === "checksum" || corrupt === "bits" ? "WavPack extended integer checksum mismatch"
      : corrupt === "width" ? "Invalid WavPack extended integer width"
      : "Missing or truncated WavPack extended integer bitstream";
    assert.ok(result.stderr.includes(message), result.stderr);
    const copied = await run(bytes, ["-c:a", "copy", "-f", "framecrc"]);
    assert.equal(copied.exitCode, 0, copied.stderr);
    assert.ok(copied.stdout.toString().includes("#codec_id 0: wavpack"));
  });
}

it("bounds extended integer decoding memory and retains probe-only access", () => {
  const bytes = fixture("int32-stereo");
  assert.throws(() => wavpackAst().parse(bytes, { limits: { maxMemoryBytes: 4096 } }), /maxMemoryBytes/);
  const doc = wavpackAst().parse(bytes, { decodeAudio: false, limits: { maxMemoryBytes: 0 } });
  assert.equal(doc.tracks[0]!.decodedAudio, undefined);
  assert.equal(doc.tracks[0]!.codecDescriptions[0]!.bitsPerSample, 32);
});
