import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg 7.0.2, default slice threading, -vf null -pix_fmt yuv444p.
const outputs = {
  10: "202020207d7d7d7d7d7d7d7d212221227d7d7d7d7c7c7c7c222222227e7e7e7e7d7e7d7e232323237d7d7d7d7c7c7c7c",
  16: "202020207c7d7c7d7d7d7d7d212121217d7d7d7d7c7c7c7c222222227d7e7d7e7d7d7d7d232323237d7d7d7d7c7c7c7c"
};
for (const depth of [10, 16] as const) {
  for (const mode of ["convert", "copy", "preserve"]) {
    const copy = mode === "copy";
    it(`reads all four ${depth}-bit Y4M frames (${mode})`, async () => {
      const payloads = [[129, 499, 501], [134, 501, 497], [137, 503, 502], [141, 500, 496]].map(values => {
        const bytes = Buffer.alloc(24);
        values.forEach((value, plane) => {
          for (let i = 0; i < 4; i++) bytes.writeUInt16LE(value << (depth - 10), (plane * 4 + i) * 2);
        });
        return bytes;
      });
      const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444p${depth}\n`),
        ...payloads.flatMap(bytes => [Buffer.from("FRAME\n"), bytes])]);
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", ...(copy ? ["-c:v", "copy"] : ["-vf", "null"]),
          "-fps_mode", "passthrough", "-pix_fmt", mode === "preserve" ? `yuv444p${depth}le` : "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(volume.readFileSync("/out.raw"), mode !== "convert" ? Buffer.concat(payloads) : Buffer.from(outputs[depth], "hex"));
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
