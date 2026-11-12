import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg bgr24 BMPs of the 5x3 RGB pattern below and its byte reversal.
const packets = [
  "424d66000000000000003600000028000000050000000300000001001800000000003000000000000000000000000000000000000000d4995ef3b87d12d79c31f6bb5015da00a56a2fc4894ee3a86d02c78c21e6ab00763b00955a1fb4793ed3985df2b77c00",
  "424d660000000000000036000000280000000500000003000000010018000000000030000000000000000000000000000000000000007cb7f25d98d33e79b41f5a95003b7600abe6218cc7026da8e34e89c42f6aa500da1550bbf6319cd7127db8f35e99d400"
].map(hex => Buffer.from(hex, "hex"));
const raw = Buffer.from(Array.from({ length: 45 }, (_, i) =>
  (31 * (Math.floor(i / 3) % 5) + 47 * Math.floor(i / 15) + 59 * (i % 3)) % 256));

for (const source of ["/pair.bmp", "pipe:0"]) {
  for (const count of [1, 2]) {
    for (const explicit of [false, true]) {
      it(`decodes ${count} BMP frames from ${source}, explicit=${explicit}`, async () => {
        const bytes = Buffer.concat(packets.slice(0, count));
        const volume = Volume.fromJSON({ "/pair.bmp": bytes });
        const output: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...(explicit ? ["-f", "image2pipe", "-c:v", "bmp"] : []),
            "-i", source, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () { yield bytes; })(),
          stdout: { async write(chunk: Uint8Array) { output.push(Buffer.from(chunk)); } },
          stderr: { async write(chunk: Uint8Array) { stderr += new TextDecoder().decode(chunk); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(Buffer.concat(output), count === 1 ? raw : Buffer.concat([raw, Buffer.from(raw).reverse()]));
      });
    }
  }
}
