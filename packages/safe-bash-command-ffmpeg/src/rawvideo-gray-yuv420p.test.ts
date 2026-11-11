import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const inputFormat of ["gray", "gray8"]) {
  for (const [filter, outputFormat, expected] of [
    [undefined, "yuv420p", "626262628080707070708080"],
    ["null", "yuv420p", "626262628080707070708080"],
    ["format=yuv420p", "yuv420p", "626262628080707070708080"],
    [undefined, "gray", "6060606070707070"]
  ] as const) {
    it(`matches native ${inputFormat} to ${outputFormat} bytes with ${filter ?? "no filter"}`, async () => {
      const volume = Volume.fromJSON({ "/in.gray": Buffer.from("6060606070707070", "hex") });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", inputFormat, "-video_size", "2x2",
          "-framerate", "4", "-i", "/in.gray", ...(filter ? ["-vf", filter] : []),
          "-pix_fmt", outputFormat, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { stdout.push(Buffer.from(data)); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      // Complete two-frame output from FFmpeg 7.0.2, including neutral U/V planes.
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
