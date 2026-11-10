import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const levels = [32, 52, 72, 92, 112, 132, 152, 172];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F6:1 Ip A1:1 C444\n"),
  ...levels.flatMap(value => [Buffer.from("FRAME\n"), Buffer.from([
    ...Array(4).fill(value), ...Array(8).fill(128)
  ])])
]);

// Native FFmpeg counts every input frame, including frames that bypass the filter.
for (const [filter, expected] of [
  ["null", levels],
  ["framestep=2", [32, 72, 112, 152]],
  ["framestep=step=2:enable=0", levels],
  ["framestep=2:enable=1", [32, 72, 112, 152]],
  ["framestep=2:enable='gte(n,3)'", [32, 52, 72, 112, 152]],
  ["framestep=step=1+1:enable='gte(n,3)'", [32, 52, 72, 112, 152]],
  ["framestep=2:enable='gte(n,3)':", [32, 52, 72, 112, 152]],
  ["framestep=enable=0:step=2", levels],
  ["framestep=enable='gte(n,3)'", levels],
  ["framestep=2:enable='gte(t,0.5)'", [32, 52, 72, 112, 152]],
  ["framestep=3:enable='mod(n,2)'", [32, 72, 92, 112, 152]],
  ["trim=start_frame=1,framestep=2:enable='gte(n,3)'", [52, 72, 92, 132, 172]],
  ["framestep=2:enable='gte(n,3)',select='gte(t,0.5)'", [112, 152]],
  ["framestep=2:enable=0.25", levels],
  ["framestep=2:enable=-0.5", [32, 72, 112, 152]],
  ["framestep=2:enable=NAN", levels],
  ["framestep=2:enable=INF", [32, 72, 112, 152]],
  ["framestep=2:enable='isnan(NAN)'", [32, 72, 112, 152]],
  ["framestep=2:enable='eq(w,2)*eq(h,2)'", [32, 72, 112, 152]],
  ...["", "unknown", "gte(n,)", "gte(n,3"].map(expression =>
    [`framestep=2:enable='${expression}'`, null] as const),
  ["trim=end_frame=0,framestep=2:enable=unknown", null],
  ["framestep=0:enable=0", null],
  ["framestep=2:enable=0:unknown=1", null],
  ["framestep=2:3:enable=0", null]
] as const) {
  for (const graph of [false, true]) it(`${filter} (${graph ? "graph" : "simple"}) preserves the framestep timeline`, async () => {
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m",
        ...(graph ? ["-filter_complex", `[0:v]${filter}[o]`, "-map", "[o]"] : ["-vf", filter]),
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    if (expected === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("framestep"), stderr);
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected.flatMap(value => [
        ...Array(4).fill(value), ...Array(8).fill(128)
      ])));
    }
  });
}
