import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2 rejects these unsupported widths before opening the output.
// Each legacy RIFF fixture contains four complete samples, with high bytes 00/40/80/c0.
for (const [tag, bits, expected] of [
  [1, 33, undefined], [1, 48, undefined], [1, 56, undefined],
  [3, 16, undefined], [3, 24, undefined], [3, 48, undefined],
  [1, 32, "00000040008000c0"], [1, 64, "00000040008000c0"],
  [3, 32, "0000ff7f00000080"], [3, 64, "0000ff7f00000080"]
] as const) for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} WAV tag ${tag}, ${bits} bits ${expected ? "decodes native PCM" : "preserves output without a decoder"}`, async () => {
    const width = Math.ceil(bits / 8);
    const input = Buffer.alloc(44 + width * 4);
    input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16); input.writeUInt16LE(tag, 20); input.writeUInt16LE(1, 22);
    input.writeUInt32LE(8000, 24); input.writeUInt32LE(8000 * width, 28);
    input.writeUInt16LE(width, 32); input.writeUInt16LE(bits, 34);
    input.write("data", 36); input.writeUInt32LE(width * 4, 40);
    for (let i = 0; i < 4; i++) input[44 + (i + 1) * width - 1] = i * 64;
    const volume = Volume.fromJSON({ "/out.raw": "keep" });
    volume.writeFileSync("/in.wav", input);
    const args = ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
    if (sync) {
      const result = evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      if (expected) assert.equal(result, "");
      else assert.equal(result, undefined);
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode === 0, expected !== undefined, stderr);
      if (!expected) assert.match(stderr, /decoder/i);
    }
    assert.deepEqual(volume.readFileSync("/out.raw"), expected ? Buffer.from(expected, "hex") : Buffer.from("keep"));
  });
}
