import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["framemd5", "framehash", "framecrc"]) {
  for (const [frameRate, timeBase] of [
    ["30000/1001", "1001/30000"],
    ["24000/1001", "1001/24000"],
    ["60000/2002", "1001/30000"],
    ["25", "1/25"]
  ]) {
    for (const copy of [true, false]) {
      it(`${format} preserves rawvideo packet rows at ${frameRate} fps (${copy ? "copy" : "encode"})`, async () => {
        const frames = [Buffer.from([0, 1, 2, 3]), Buffer.from([4, 5, 6, 7])];
        const volume = Volume.fromJSON({ "/in.raw": Buffer.concat(frames) });
        let stdout = "", stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
            "-framerate", frameRate!, "-i", "/in.raw", "-bitexact", ...(copy ? ["-c", "copy"] : []),
            "-f", format, "-"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const hash = format === "framemd5" ? "md5" : "sha256";
        assert.equal(stdout, [
          ...(format === "framecrc" ? [] : ["#format: frame checksums", "#version: 2", `#hash: ${hash.toUpperCase()}`]),
          `#tb 0: ${timeBase}`, "#media_type 0: video", "#codec_id 0: rawvideo",
          "#dimensions 0: 2x2", "#sar 0: 0/1",
          ...(format === "framecrc" ? [] : ["#stream#, dts,        pts, duration,     size, hash"]),
          ...frames.map((frame, index) => {
            const digest = format === "framecrc" ? ["0x000a0006", "0x00320016"][index]
              : createHash(hash).update(frame).digest("hex");
            return `0,          ${index},          ${index},        1,        4, ${digest}`;
          }), ""
        ].join("\n"));
      });
    }
  }
}
