import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const format of ["wav", "mulaw", "alaw"]) {
  for (const sync of [false, true]) {
    it(`writes IRCAM ${format} audio (${sync ? "sync" : "async"})`, async () => {
      // Reconstruct the reported 8 kHz mono WAV with samples 0 through 7999.
      const input = format === "wav" ? Buffer.alloc(16044) : Buffer.from(Array.from({ length: 256 }, (_, i) => i));
      if (format === "wav") {
        Buffer.from("52494646a43e000057415645666d74201000000001000100401f0000803e00000200100064617461803e0000", "hex").copy(input);
        for (let i = 0; i < 8000; i++) input.writeInt16LE(i, 44 + i * 2);
      }
      const volume = Volume.fromJSON({ "/out.sf": "keep" });
      volume.writeFileSync("/in.bin", input);
      const args = ["-v", "error", "-y", ...(format === "wav" ? [] : ["-f", format, "-ar", "8000", "-ac", "1"]),
        "-i", "/in.bin", ...(sync ? [] : ["-map", "0:a"]), "-c:a", format === "wav" ? "pcm_s16le" : "copy", "-f", "ircam", "/out.sf"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.sf") as Buffer;
      assert.equal(output.readUInt32LE(0), 0x0001a364);
      assert.equal(output.readFloatLE(4), 8000);
      assert.equal(output.readUInt32LE(8), 1);
      assert.equal(output.readUInt32LE(12), format === "wav" ? 2 : format === "mulaw" ? 0x20001 : 0x10001);
      assert.deepEqual(output.subarray(16, 1024), Buffer.alloc(1008));
      assert.deepEqual(output.subarray(1024), format === "wav" ? input.subarray(44) : input);
    });
  }
}
