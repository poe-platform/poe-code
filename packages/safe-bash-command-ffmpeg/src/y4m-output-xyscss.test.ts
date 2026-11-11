import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 headers and payloads for a 2x2 gray frame with value 1.
for (const [pixelFormat, chroma, payload] of [
  ["yuv420p", "420jpeg XYSCSS=420JPEG", "111111118080"],
  ["yuv422p", "422 XYSCSS=422", "1111111180808080"],
  ["yuv444p", "444 XYSCSS=444", "111111118080808080808080"],
  ["gray", "mono", "01010101"]
] as const) {
  for (const target of ["/out.y4m", "-"]) {
    it(`writes native ${pixelFormat} Y4M chroma tags and samples to ${target}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.alloc(4, 1) });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-framerate", "4",
          "-pixel_format", "gray", "-video_size", "2x2", "-i", "/in.raw",
          "-pix_fmt", pixelFormat, "-f", "yuv4mpegpipe", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stderr).toString(), "");
      const output = target === "-" ? Buffer.concat(stdout) : volume.readFileSync(target) as Buffer;
      const headerEnd = output.indexOf(10);
      const header = output.subarray(0, headerEnd).toString();
      assert.equal(header.split(" ").filter(field => field.startsWith("C") || field.startsWith("XYSCSS=")).join(" "), `C${chroma}`);
      assert.deepEqual(output.subarray(headerEnd + 1), Buffer.concat([
        Buffer.from("FRAME\n"), Buffer.from(payload, "hex")
      ]));
    });
  }
}
