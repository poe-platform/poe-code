import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: NaN disables the filter, infinity enables it, and |value| >= 0.5 enables it.
for (const [enable, drawn] of [
  ["NAN", false], ["nan", false], ["NaN", false], ["0/0", false],
  ["inf", true], ["INF", true], ["Infinity", true], ["-inf", true],
  ["1/0", true], ["-1/0", true], ["sqrt(-1)", false], ["abs(NAN)", false],
  ["abs(-inf)", true], ["isnan(NAN)", true], ["isinf(inf)", true],
  ["0", false], ["1", true], ["0.49", false], ["-0.49", false],
  ["0.5", true], ["-0.5", true],
  ["if(eq(n,0),NAN,inf)", [false, true, true]],
  ["if(eq(t,0.5),0/0,1/0)", [true, false, true]],
  ["NANjunk", null], ["infjunk", null], ["unknown(0/0)", null], ["abs(inf", null]
] as const) {
  it(`matches native drawbox enable=${enable}`, async () => {
    const frame = Buffer.from("0724415e7b98b5d2ef0c294663809dba", "hex");
    const input = Buffer.concat([frame, frame, frame]);
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    const argumentValues = createCommandArguments([
      "-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "4x4", "-framerate", "2", "-i", "/in.raw",
      "-vf", `drawbox=x=1:y=1:w=1:h=1:t=fill:c=white:enable='${enable}'`,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "/out.raw"
    ]);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      command: "ffmpeg", args: argumentValues.args, argumentValues,
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (drawn === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("drawbox enable"), stderr);
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.from(input);
      for (let n = 0; n < 3; n++) {
        if (typeof drawn === "boolean" ? drawn : drawn[n]) expected[n * 16 + 5] = 255;
      }
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
    }
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
