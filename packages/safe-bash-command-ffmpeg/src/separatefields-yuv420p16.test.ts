import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Full raw output from native FFmpeg 7.0.2 for one 2x4 frame at 4 fps.
const input420 = "11589fe62d74bb024990d71e65acf33a81c80f569de42b72";
const topStats = "checksum:25320686 plane_checksum:[0FC803BC 01CA0149 021E0181] mean:[31604 51329 58525] stdev:[18876.6 0.0 0.0]";
const bottomStats = "checksum:1F2E049E plane_checksum:[0EB8039C 00740065 00C8009D] mean:[22416 22031 29227] stdev:[16206.2 0.0 0.0]";
for (const [format, filter, input, expected, statistics] of [
  ["yuv420p16le", "setfield=tff,separatefields", input420,
    "11589fe64990d71e81c89de42d74bb0265acf33a0f562b72", [topStats, bottomStats]],
  ["yuv420p16le", "setfield=bff,separatefields", input420,
    "2d74bb0265acf33a0f562b7211589fe64990d71e81c89de4", [bottomStats, topStats]],
  ["yuv420p16le", "null", input420, input420,
    ["checksum:86D00B24 plane_checksum:[3AA00758 04D001AE 05E8021E] mean:[27010 36680 43876] stdev:[18182.1 14649.0 14649.0]"]],
  ["yuv444p16le", "setfield=tff,separatefields",
    `${input420}b900478ed51c63aaf1387fc60d549be22970b7fe458cd31a`,
    "11589fe64990d71e81c80f56b900478ef1387fc62970b7fe2d74bb0265acf33a9de42b72d51c63aa0d549be2458cd31a",
    ["checksum:89380BB4 plane_checksum:[0FC803BC 0F88033C 144804BC] mean:[31604 27492 39828] stdev:[18876.6 18864.4 19531.8]",
      "checksum:8C080B54 plane_checksum:[0EB8039C 1378041C 0F38039C] mean:[22416 34688 30576] stdev:[16206.2 18864.4 18876.6]"]]
] as const) {
  for (const showinfo of [false, true]) {
    it(`preserves ${format} planes through ${filter}${showinfo ? " with showinfo" : ""}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
      const stdout: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", showinfo ? "info" : "error",
          "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x4", "-framerate", "4", "-i", "/in.raw",
          "-vf", `${filter}${showinfo ? ",showinfo" : ""}`, "-fps_mode", "passthrough",
          "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const stderr = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
      if (showinfo) {
        const info = stderr.split("\n").filter(line => line.startsWith("[showinfo] n:"));
        const separated = filter !== "null";
        assert.equal(info.length, separated ? 2 : 1, stderr);
        for (const [index, line] of info.entries()) {
          assert.ok(line.startsWith(`[showinfo] n:${index} pts:${index} pts_time:${index / 8} `), line);
          assert.ok(line.includes(`duration:1 duration_time:${separated ? 0.125 : 0.25} `), line);
          assert.ok(line.includes(`fmt:${format} cl:unspecified sar:0/1 s:2x${separated ? 2 : 4} i:P iskey:1 type:I`), line);
          assert.ok(line.endsWith(statistics[index]!), line);
        }
      } else {
        assert.equal(stderr, "");
      }
      assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
    });
  }
}
