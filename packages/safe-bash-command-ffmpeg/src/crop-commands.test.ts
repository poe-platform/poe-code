import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 48 }, (_, i) => [16 + i, 32 + i, 64 + i, 128 + i]).flat());
const original = "10204080112141811424448415254585";
const still = original + "20305090213151912434549425355595" + "304060a0314161a1344464a4354565a5";
const movedX = original + "22325292233353932636569627375797" + "324262a2334363a3364666a6374767a7";
const movedY = original + "28385898293959992c3c5c9c2d3d5d9d" + "384868a8394969a93c4c6cac3d4d6dad";
const wider = original + "203050902131519122325292243454942535559526365696" + "304060a0314161a1324262a2344464a4354565a5364666a6";

// Byte-for-byte Linux FFmpeg 7.0.2 results for three 4x4 RGBA frames at 4 fps.
for (const [filter, expected] of [
  ["crop=2:2:0:0", still],
  ["sendcmd=c='0.25 crop x 2',crop=2:2:0:0", movedX],
  ["sendcmd=c='0.25 crop@c y 2',crop@c=2:2:0:0", movedY],
  ["sendcmd=c='0.25 crop w 3',crop=2:2:0:0", wider],
  ["sendcmd=commands='0.25 [enter] crop out_w 3',crop=2:2:0:0", wider],
  ["sendcmd=c='0.25 crop@missing x 2',crop@c=2:2:0:0", still],
  ["sendcmd=c='0.25 crop@c x 2',crop@other=4:4:0:0,crop@c=2:2:0:0", movedX],
  ["sendcmd=c='0.25 crop x 2',crop@c=2:2:0:0,crop@other=2:2:0:0", movedX],
  ["setpts=PTS+2/TB,sendcmd=c='2.25 crop x 2',crop=2:2:0:0", movedX],
  ["sendcmd=c='0.25 crop w 3;0.5 crop w 5',crop=2:2:0:0", wider],
  ["sendcmd=c='0.26 crop x 2',crop=2:2:0:0", still.slice(0, 64) + movedX.slice(64)],
  ["sendcmd=c='0.5 crop x 0;0.25 crop x 2',crop=2:2:0:0", movedX.slice(0, 64) + still.slice(64)],
  ["sendcmd=c='0.25 crop x n',crop=2:2:0:0", original + "21315191223252922535559526365696" + movedX.slice(64)],
  ["sendcmd=c='0.25 crop w 4',crop=2:2",
    "1525458516264686192949891a2a4a8a2434549425355595263656962737579728385898293959992a3a5a9a2b3b5b9b344464a4354565a5364666a6374767a7384868a8394969a93a4a6aaa3b4b6bab"],
  ["sendcmd=c='0.25 crop h 4',crop=w=oh:h=2:x=0:y=0", original + input.subarray(64).toString("hex")],
  ["sendcmd=c='bad crop x 2',crop=2:2:0:0", null]
] as const) {
  for (const graph of [false, true]) {
    it(`timed crop (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
          "-video_size", "4x4", "-framerate", "4", "-i", "/in.raw", ...(graph
            ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
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
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
