import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 exit status and exact stdout for PGM grayscale conversion.
for (const [name, input, pixelFormat, encoder, expected] of [
  ["8-bit to big-endian raw", "50350a3420310a3235350a11227fff", "gray16be", "rawvideo", "111122227f7fffff"],
  ["8-bit to little-endian raw", "50350a3420310a3235350a11227fff", "gray16le", "rawvideo", "111122227f7fffff"],
  ["8-bit to PGM", "50350a3420310a3235350a11227fff", "gray16be", "pgm", "50350a3420310a36353533350a111122227f7fffff"],
  ["unchanged 8-bit raw", "50350a3420310a3235350a11227fff", "gray", "rawvideo", "11227fff"],
  ["unchanged 16-bit raw", "50350a3420310a36353533350a12343456789abcde", "gray16be", "rawvideo", "12343456789abcde"],
  ["16-bit raw byte order", "50350a3420310a36353533350a12343456789abcde", "gray16le", "rawvideo", "341256349a78debc"],
  ["unchanged 16-bit PGM", "50350a3420310a36353533350a12343456789abcde", "gray16be", "pgm", "50350a3420310a36353533350a12343456789abcde"]
] as const) {
  for (const source of ["file", "pipe"]) {
    it(`matches native PGM ${name} from ${source}`, async () => {
      const bytes = Buffer.from(input, "hex");
      const volume = Volume.fromJSON({ "/in.pgm": bytes });
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...(source === "pipe" ? ["-f", "image2pipe", "-c:v", "pgm"] : []),
          "-i", source === "pipe" ? "pipe:0" : "/in.pgm", "-pix_fmt", pixelFormat, "-c:v", encoder,
          "-f", encoder === "pgm" ? "image2pipe" : "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { if (source === "pipe") yield bytes; })(),
        stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(chunks).toString("hex"), expected);
    });
  }
}
