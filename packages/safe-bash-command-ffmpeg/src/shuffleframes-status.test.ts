import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F6:1 Ip A1:1 C444\n"),
  ...Array.from({ length: 8 }, (_, i) => Buffer.concat([
    Buffer.from("FRAME\n"), Buffer.alloc(4, 32 + 20 * i), Buffer.alloc(8, 128)
  ]))
]);

for (const graph of [false, true]) {
  for (const [mapping, status] of [["2 0", 234], ["mapping=2 0", 234], ["foo=1", 8], ["1 0:foo=1", 8], ["1 0", 0]] as const) {
    it(`shuffleframes=${mapping} returns native status (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      let stderr = "";
      const filter = `shuffleframes=${mapping}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      if (status) {
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        assert.ok(stderr.includes("shuffleframes:"), stderr);
        if (status === 8) assert.ok(stderr.includes("unsupported option foo"), stderr);
      } else {
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 96);
        assert.deepEqual(Array.from({ length: 8 }, (_, i) => output[i * 12]), [52, 32, 92, 72, 132, 112, 172, 152]);
      }
    });
  }
}
