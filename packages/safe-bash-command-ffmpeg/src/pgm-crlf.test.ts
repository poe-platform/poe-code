import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeFfmpegImage } from "./decode-image.js";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 consumes exactly one byte between a binary PNM header and raster.
for (const [name, input, format, expected] of [
  ["CRLF", "50350d0a3420310d0a3235350d0a11227fff", "gray", "0a11227f"],
  ["LF", "50350a3420310a3235350a11227fff", "gray", "11227fff"],
  ["CR followed by an LF sample", "50350a3420310a3235350d0a11227f", "gray", "0a11227f"],
  ["16-bit CRLF", "50350d0a3220310d0a36353533350d0a12345678", "gray16be", "0a123456"],
  ["16-bit LF", "50350a3220310a36353533350a12345678", "gray16be", "12345678"],
  ["PBM CRLF", "50340d0a3820310d0aff", "gray", "ffffffff00ff00ff"],
  ["PBM LF", "50340a3820310aff", "gray", "0000000000000000"],
  ["PPM CRLF", "50360d0a3120310d0a3235350d0a112233", "rgb24", "0a1122"],
  ["PPM LF", "50360a3120310a3235350a112233", "rgb24", "112233"],
  ["header comment", "50350d0a2320636f6d6d656e740d0a3420310d0a3235350d0a11227fff", "gray", "0a11227f"]
] as const) {
  for (const source of ["file", "sequence", "pipe"] as const) {
    it(`matches native PNM ${name} from ${source}`, async () => {
      const bytes = Buffer.from(input, "hex");
      // Pipe packets end immediately after the declared raster, without file padding.
      const packet = name.includes("CRLF") || name === "header comment" ? bytes.subarray(0, -1) : bytes;
      const codec = bytes[1] === 54 ? "ppm" : bytes[1] === 52 ? "pbm" : "pgm";
      const volume = Volume.fromJSON({ [`/in.${codec}`]: bytes, [`/in1.${codec}`]: bytes, [`/in2.${codec}`]: bytes });
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...(source === "pipe" ? ["-f", "image2pipe", "-c:v", codec] : []),
          "-i", source === "pipe" ? "pipe:0" : source === "sequence" ? `/in%d.${codec}` : `/in.${codec}`,
          "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { if (source === "pipe") { yield packet; yield packet; } })(),
        stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(chunks).toString("hex"), expected.repeat(source === "file" ? 1 : 2));
      assert.equal(volume.readFileSync(`/in.${codec}`).toString("hex"), input);
    });
  }
}

it("preserves original Buffer packets when adapting the PGM separator", () => {
  const bytes = Buffer.from("50350d0a3420310d0a3235350d0a11227fff", "hex");
  const original = Buffer.from(bytes);
  const image = decodeFfmpegImage(bytes);
  assert.deepEqual(Array.from(image.data.filter((_, i) => i % 4 === 0)), [10, 17, 34, 127]);
  assert.deepEqual(bytes, original);
});
