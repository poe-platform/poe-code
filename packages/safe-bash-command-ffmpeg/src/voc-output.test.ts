import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["s16le", "alaw", "mulaw", "f32le"]) {
  for (const copy of [false, true]) {
    it(`${format === "f32le" ? "rejects unsupported" : "writes"} VOC ${format} with ${copy ? "copy" : "encoding"}`, async () => {
      const input = Buffer.alloc(format === "s16le" ? 64 : 256);
      if (format === "s16le") {
        for (let i = 0; i < 16; i++) {
          input.writeInt16LE(72 + 100 * i, i * 4);
          input.writeInt16LE(-1024 - 20 * i, i * 4 + 2);
        }
      } else for (let i = 0; i < 256; i++) input[i] = i;
      const volume = Volume.fromJSON({ "/out.voc": "keep" });
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", format, "-ar", "8000", "-ac", format === "s16le" ? "2" : "1",
          "-i", "/in.raw", "-c:a", copy ? "copy" : `pcm_${format}`, "-f", "voc", "/out.voc"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (format === "f32le") {
        assert.equal(result.exitCode, 1);
        assert.match(stderr, /Unsupported VOC audio codec/);
        assert.equal(volume.readFileSync("/out.voc").toString(), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.voc") as Buffer;
      assert.equal(output.subarray(0, 20).toString(), "Creative Voice File\x1a");
      assert.equal(output.readUInt16LE(20), 26);
      assert.equal(output[26], 9);
      assert.equal(output.readUInt32LE(30), 8000);
      assert.equal(output[35], format === "s16le" ? 2 : 1);
      assert.equal(output.readUInt16LE(36), format === "s16le" ? 4 : format === "alaw" ? 6 : 7);
      assert.equal(output.at(-1), 0);
      if (copy || format === "s16le") assert.deepEqual(output.subarray(42, -1), input);
    });
  }
}
