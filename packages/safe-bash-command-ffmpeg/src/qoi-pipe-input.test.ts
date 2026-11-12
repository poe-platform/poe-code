import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Literal QOI RGBA opcodes keep the expected pixels independent of the encoder.
const pixels = Buffer.from(Array.from({ length: 32 }, (_, i) =>
  (i % 4 * 59 + Math.floor(i / 4) % 4 * 23 + Math.floor(i / 16) * 47) % 256));
const packet = Buffer.concat([
  Buffer.from("716f696600000004000000020401", "hex"),
  ...Array.from({ length: 8 }, (_, i) => Buffer.concat([Buffer.from([255]), pixels.subarray(i * 4, i * 4 + 4)])),
  Buffer.from("0000000000000001", "hex")
]);

for (const source of ["/in.qoi", "pipe:0"]) {
  for (const frames of [1, 2]) {
    for (const copy of [false, true]) {
      it(`reads ${frames} linear RGBA QOI frame(s) from ${source} with ${copy ? "stream copy" : "raw decoding"}`, async () => {
        const input = Buffer.concat(Array.from({ length: frames }, () => packet));
        const volume = Volume.fromJSON({ "/in.qoi": input });
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "qoi_pipe", "-i", source,
            ...(copy ? ["-c:v", "copy", "-f", "image2pipe"] : ["-pix_fmt", "rgba", "-f", "rawvideo"]), "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () { yield input; })(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(Buffer.concat(chunks), copy ? input : Buffer.concat(Array.from({ length: frames }, () => pixels)));
      });
    }
  }
}
