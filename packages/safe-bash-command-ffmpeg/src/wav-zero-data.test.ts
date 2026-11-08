import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const samples of [[11, 22, 33, 44, -55, -66, -77, -88], [24932, 24948, 4, 0, -100, -200]]) {
  for (const declared of [0, samples.length * 2, 0xffffffff]) {
    for (const codec of ["copy", "pcm_s16le"]) {
      for (const mode of declared === 0xffffffff ? ["file", "pipe"] : ["sync", "file", "pipe"]) {
        it(`preserves ${samples.length} PCM samples with data size ${declared} (${codec}, ${mode})`, async () => {
          const input = Buffer.alloc(44 + samples.length * 2);
          input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
          input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
          input.writeUInt32LE(8000, 24); input.writeUInt32LE(16000, 28);
          input.writeUInt16LE(2, 32); input.writeUInt16LE(16, 34); input.write("data", 36);
          input.writeUInt32LE(declared, 40);
          samples.forEach((sample, index) => input.writeInt16LE(sample, 44 + index * 2));
          const volume = Volume.fromJSON({});
          volume.writeFileSync("/in.wav", input);
          const args = ["-y", "-v", "error", "-i", mode === "pipe" ? "pipe:0" : "/in.wav", "-c:a", codec, "-f", "s16le", "/out.raw"];
          if (mode === "sync") {
            assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
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
              stdin: (async function* () { if (mode === "pipe") yield input; })(),
              stdout: { async write() {} },
              stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
            } as never);
            assert.equal(result.exitCode, 0, stderr);
          }
          assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(44));
        });
      }
    }
  }
}
