import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const predicate of ["eq(pts,1)", "eq(t,1)", "eq(pts*TB,1)"]) {
  it(`exposes the woven time base to select ${predicate} and showinfo`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from("0d141b22", "hex") });
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
        "-s", "1x1", "-r", "2", "-i", "/in.raw", "-vf", `weave,select='${predicate}',showinfo`,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), "1b22");
    assert.ok(stderr.includes("time_base: 1/1, frame_rate: 1/1"), stderr);
    assert.ok(stderr.includes("pts:1 pts_time:1 duration:1 duration_time:1"), stderr);
  });
}
