import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["null", "framestep=2", "setsar=0", "setsar=1", "setsar=4/3"]) {
  it(`writes the native Y4M aspect ratio after ${filter}`, async () => {
    const input = Buffer.from([13, 20, 27, 34]);
    const volume = Volume.fromJSON({ "/in.raw": input });
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
        "-s", "2x2", "-r", "6", "-i", "/in.raw", "-vf", `${filter},showinfo`,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "yuv4mpegpipe", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = Buffer.concat(output);
    const header = bytes.subarray(0, bytes.indexOf(10)).toString().split(" ");
    const aspect = filter === "setsar=1" ? "1:1" : filter === "setsar=4/3" ? "4:3" : "0:0";
    assert.deepEqual(header.filter(token => token.startsWith("A")), [`A${aspect}`]);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
