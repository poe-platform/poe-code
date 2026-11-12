import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const filter of [undefined, "null", "format=yuv420p"]) {
  it(`matches native RGB24 to YUV420P rounding with ${filter ?? "no filter"}`, async () => {
    const volume = Volume.fromJSON({
      "/in.raw": Buffer.from("a22880a22880a22880a22880", "hex")
    });
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2x2", "-r", "4",
        "-i", "/in.raw", ...(filter ? ["-vf", filter] : []), "-fps_mode", "passthrough",
        "-pix_fmt", "yuv420p", "-bitexact", "-f", "rawvideo", "pipe:1"],
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
    // Native FFmpeg 7.0.2 exit status and complete raw output, including both chroma planes.
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), "5a5a5a5a95af");
  });
}
