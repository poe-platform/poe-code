import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 results for 4x2 YUV444 frames with 3:2 sample aspect ratio.
const input = "32333435363738391c1d1e1f20212223c8c9cacbcccdcecf";
for (const chroma of ["444", "422"]) {
  for (const [filter, width, height, aspect, pixels] of [
    ["transpose=clock", 2, 4, "2:3", "3632373338343935201c211d221e231fccc8cdc9cecacfcb"],
    ["transpose=clock,crop=1:1:0:sar*2", 1, 1, "2:3", "3721cd"],
    ["transpose=cclock_flip,crop=1:1:0:sar*2", 1, 1, "2:3", "331dc9"],
    ["transpose=cclock", 2, 4, "2:3", "35393438333732361f231e221d211c20cbcfcacec9cdc8cc"],
    ["transpose=clock_flip", 2, 4, "2:3", "3935383437333632231f221e211d201ccfcbcecacdc9ccc8"],
    ["null", 4, 2, "3:2", input],
    ["transpose=clock,transpose=cclock", 4, 2, "3:2", input],
    ["transpose=clock:landscape,crop=1:1:0:sar*2", 1, 1, "3:2", "3620cc"],
    ["transpose=clock,transpose=cclock:portrait", 2, 4, "2:3", "3632373338343935201c211d221e231fccc8cdc9cecacfcb"],
    ["transpose=4", 4, 2, "3:2", input]
  ] as const) {
    // Odd crop sizes require the unsubsampled input. C422 exercises the RGBA rotation path.
    if (chroma === "422" && filter.includes("crop=")) continue;
    it(`${filter} propagates C${chroma} sample aspect ratio through two frames`, async () => {
      const frame = Buffer.from(chroma === "444" ? input : "32333435363738391c1d1e1fc8c9cacb", "hex");
      const source = Buffer.concat([
        Buffer.from(`YUV4MPEG2 W4 H2 F4:1 Ip A3:2 C${chroma}\nFRAME\n`), frame,
        Buffer.from("FRAME\n"), frame
      ]);
      const volume = Volume.fromJSON({ "/in.y4m": source, "/out.y4m": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/out.y4m"],
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
      const output = volume.readFileSync("/out.y4m") as Buffer;
      const header = output.subarray(0, output.indexOf(10)).toString().split(" ");
      for (const field of [`W${width}`, `H${height}`, "F4:1", "Ip", `A${aspect}`, "C444"]) {
        assert.ok(header.includes(field), `${field} missing from ${header.join(" ")}`);
      }
      if (chroma === "444") {
        const expected = Buffer.concat([Buffer.from("FRAME\n"), Buffer.from(pixels, "hex")]);
        assert.deepEqual(output.subarray(output.indexOf(10) + 1), Buffer.concat([expected, expected]));
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), source);
    });
  }
}
