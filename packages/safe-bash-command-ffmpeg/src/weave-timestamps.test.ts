import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [upstream, input, pts, timeBase] of [
  ["null", [13, 20], 0, "1/1"],
  ["select='not(eq(n,1))'", [13, 20, 27], 1, "1/1"],
  ["setpts=2*PTS", [13, 27], 1, "1/1"],
  ["setpts=3*PTS", [13, 27], 1, "1/1"],
  ["settb=1/4", [13, 27], 1, "1/2"],
  ["setpts=PTS-2", [13, 27], 0, "1/1"]
] as const) {
  for (const field of ["top", "bottom"]) {
    it(`timestamps ${field}-first weave after ${upstream} from the second field`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input) });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", "1x1", "-r", "2", "-i", "/in.raw", "-vf", `${upstream},weave=${field},showinfo`,
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pixels = [input[0], input[input.length - 1]!];
      assert.deepEqual(Buffer.concat(stdout), Buffer.from(field === "top" ? pixels : pixels.reverse()));
      assert.ok(stderr.includes(`pts_time:${pts * (timeBase === "1/2" ? 0.5 : 1)} `), stderr);
      assert.ok(stderr.includes(`pts:${pts} `), stderr);
      assert.ok(stderr.includes(`config in time_base: ${timeBase},`), stderr);
    });
  }
}
