import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 image2 inputs, independent of the image2 plane writer.
for (const [format, chroma, oddChroma] of [
  ["yuv420p", "5a", "5a607080"],
  ["yuv422p", "5a5a", "5a60708090a0"],
  ["yuv444p", "5a5a5a5a", "5a60708090a0b0c0d0"]
] as const) {
  for (const mode of ["copy", "encode", "default-output", "odd-size", "missing-chroma", "short-chroma", "shifted-boundary"]) {
    it(`reads numbered ${format} image2 planes: ${mode}`, async () => {
      const volume = new Volume();
      const y = Buffer.from(mode === "odd-size" ? "104080eb1020304050" : "104080eb", "hex");
      const u = Buffer.from(mode === "odd-size" ? oddChroma : chroma, "hex");
      const v = Buffer.alloc(u.length, 0xf0);
      const packets: Buffer[] = [];
      for (let frame = 1; frame <= 2; frame++) {
        const planes = [Buffer.from(y), u, v];
        if (frame === 2) planes[0]![0] = 0xeb;
        for (const [plane, suffix] of ["Y", "U", "V"].entries()) {
          volume.writeFileSync(`/seq${frame}.${suffix}`, planes[plane]!);
        }
        packets.push(Buffer.concat(planes));
      }
      if (mode === "missing-chroma") volume.unlinkSync("/seq2.U");
      if (mode === "short-chroma") volume.writeFileSync("/seq2.V", v.subarray(1));
      if (mode === "shifted-boundary") {
        volume.writeFileSync("/seq2.Y", Buffer.concat([y, u.subarray(0, 1)]));
        volume.writeFileSync("/seq2.U", u.subarray(1));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "image2", "-video_size", mode === "odd-size" ? "3x3" : "2x2",
          "-pixel_format", format, "-i", "/seq%d.Y",
          ...(mode === "copy" ? ["-c:v", "copy"] : mode === "default-output" ? [] : ["-pix_fmt", format]),
          "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (["missing-chroma", "short-chroma", "shifted-boundary"].includes(mode)) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes(mode === "missing-chroma" ? "seq2.U" : "Invalid image2 plane sizes"), stderr);
        assert.equal(volume.existsSync("/out.raw"), false);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(packets));
      }
    });
  }
}
