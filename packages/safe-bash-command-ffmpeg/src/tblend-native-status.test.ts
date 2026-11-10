import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frames = [[50, 30, 212], [120, 180, 60], [120, 180, 60], [80, 140, 190]]
  .map(frame => Buffer.concat(frame.map(value => Buffer.alloc(4, value))));

for (const [filter, exitCode] of [
  ["tblend=all_mode=40", 222],
  ["tblend=all_mode=-2", 222],
  ["tblend=all_mode=20*2", 222],
  ["tblend=all_mode=bogus", 234],
  ["tblend=all_mode=", 234],
  ["tblend=unknown=6", 8],
  ["null", 0],
  ["tblend=all_mode=difference", 0]
] as const) {
  it(`${filter} returns native status ${exitCode} and preserves existing files on failure`, async () => {
    const volume = Volume.fromJSON({
      "/in.y4m": Buffer.concat([
        Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
      ]),
      "/o.raw": "KEEP"
    });
    const before = volume.toJSON();
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "in.y4m", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "o.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    if (exitCode !== 0) {
      assert.deepEqual(volume.toJSON(), before);
      assert.ok(stderr.includes("tblend:"), stderr);
    } else {
      const expected = filter === "null" ? Buffer.concat(frames)
        : Buffer.from("464646469696969698989898000000000000000000000000282828282828282882828282", "hex");
      assert.deepEqual(volume.readFileSync("/o.raw"), expected);
    }
  });
}
