import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const red = "ef203040879abcde";
const blue = "1020cf40789a43de";

// FFmpeg 7.0.2: three RGBA frames at 2 fps; alpha must stay unchanged.
for (const [filter, expected] of [
  ["negate@x=components=r", red.repeat(3)],
  ["sendcmd=c='0.5 negate@x components b',negate@x=components=r", red + blue + blue],
  ["sendcmd=c='0.51 negate@x components b',negate@x=components=r", red + red + blue],
  ["sendcmd=c='0.5 negate@other components b',negate@x=components=r", red.repeat(3)],
  ["sendcmd=commands='0 [enter] negate@x components b;1 negate@x components r',negate@x=components=r", blue + blue + red],
  ["sendcmd=c='0.5 negate components b',negate@x=components=r,negate@other=components=0", red + blue + blue],
  ["sendcmd=c='0.5 negate@x components b',negate@other=components=0,negate@x=components=r", red + blue + blue],
  ["sendcmd=c='0.5 negate@x components invalid;1 negate@x components b',negate@x=components=r", red + red + blue],
  ["sendcmd=c='0.5 negate@x components b+invalid',negate@x=components=r", red.repeat(3)],
  ["sendcmd=c='0.5 negate@x components +b-r',negate@x=components=r", red + blue + blue],
  ["setpts=PTS+2/TB,sendcmd=c='2.5 negate@x components b',negate@x=components=r", red + blue + blue],
  ["sendcmd=c='0.5 negate@x components b',negate@x=components=r:enable=gte(n\\,2)", "10203040789abcde".repeat(2) + blue],
  ["sendcmd=c='bad negate@x components b',negate@x=components=r", null],
  ["sendcmd=c='',negate@x=components=r", null],
  ["sendcmd=c='0.5 negate@x unsupported b',negate@x=components=r", null],
] as const) {
  for (const graph of [false, true]) {
    it(`scheduled negate components (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({
        "/in.raw": Buffer.from("10203040789abcde".repeat(3), "hex"),
        "/out.raw": "KEEP"
      });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
          "-video_size", "2x1", "-framerate", "2", "-i", "/in.raw", ...(graph
            ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("sendcmd:"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      }
      assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), "10203040789abcde".repeat(3));
    });
  }
}
