import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Independent Python wave input and native FFmpeg AU output.
const wav = Buffer.from("524946463600000057415645666d74201000000001000100401f0000803e00000200100064617461120000000080ffbffffeffff0000010001010140ff7f", "hex");
const au = Buffer.from("2e736e6400000020000000120000000300001f400000000100000000000000008000bffffeffffff00000001010140017fff", "hex");

for (const direction of ["encode", "decode"]) {
  for (const sync of [false, true]) {
    it(`supports AU ${direction} (${sync ? "sync" : "async"})`, async () => {
      const input = direction === "encode" ? wav : au;
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.bin", input);
      const args = ["-v", "error", "-y", "-i", "/in.bin", "-f", direction === "encode" ? "au" : "s16le", "/out.bin"];
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
      const output = volume.readFileSync("/out.bin") as Buffer;
      if (direction === "encode") {
        assert.equal(output.toString("ascii", 0, 4), ".snd");
        assert.equal(output.readUInt32BE(12), 3);
        assert.equal(output.readUInt32BE(16), 8000);
        assert.equal(output.readUInt32BE(20), 1);
        assert.deepEqual(output.subarray(output.readUInt32BE(4)), au.subarray(32));
      } else assert.deepEqual(output, wav.subarray(44));
    });
  }
}
