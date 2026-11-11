import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [filter, expected] of [
  ["sendcmd=c=1 tmix enable 0,tmix=frames=2", "1160affe1160affe4d9ceb3a89d82776"],
  ["sendcmd=c=1 tmix@a enable 0,tmix@a=frames=2", "1160affe1160affe4d9ceb3a89d82776"],
  ["tmix=frames=2:enable=lt(t\\,1)", "1160affe1160affe4d9ceb3a89d82776"],
  ["tmix=frames=2", "1160affe2f7ecd9c6bba8958a7764594"],
  ["sendcmd=c='1 tmix enable 0;2 tmix enable invalid',tmix=frames=2", "1160affe1160affe4d9ceb3a89d82776"],
  ["sendcmd=c=1 tmix@missing enable 0,tmix@a=frames=2", "1160affe2f7ecd9c6bba8958a7764594"]
]) {
  for (const graph of [false, true]) it(`tmix enable command ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from("1160affe4d9ceb3a89d82776c51463b2", "hex") });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
        "-framerate", "1", "-i", "/in.raw", ...(graph
          ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
        "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stderr).toString(), "");
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
  });
}
