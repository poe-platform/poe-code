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
  ["sendcmd='0.166 framestep enable 0',framestep=2", levels],
  ["sendcmd='0.167 framestep enable 0',framestep=2", [32, 72, 92, 112, 132, 152, 172]],
  ["sendcmd='0.166 framestep@stride enable 1',framestep@stride=2:enable=0", [32, 72, 112, 152]],
  ["sendcmd='0.166 framestep@other enable 0',framestep@stride=2", [32, 72, 112, 152]],
  ["sendcmd='0.166 framestep enable 0',framestep@first=2,framestep@second=2", [32, 72, 112, 152]],
  ["sendcmd='0.166 framestep@second enable 0',framestep@first=2,framestep@second=2", [32, 72, 112, 152]],
  ["sendcmd='0 framestep enable 0;0.5 framestep enable 1',framestep=2", [32, 52, 72, 112, 152]],
  ["sendcmd='0 framestep enable invalid;0.166 framestep enable 0',framestep=2", levels],
  ["sendcmd='0 framestep enable 0;0.166 framestep enable invalid',framestep=2", levels],
  ["sendcmd='0.166 framestep enable n/3',framestep=2", [32, 52, 72, 112, 152]],
  ["setpts=PTS+1/TB,sendcmd='1.166 framestep enable 0',framestep=2", levels],
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

it("runtime disable preserves all raw frames and their original timestamps", async () => {
  const input = Buffer.from(Array.from({ length: 16 }, (_, i) => 13 + 7 * i));
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
      "-s", "2x2", "-r", "6", "-i", "/in.raw", "-vf",
      "sendcmd='0.166 framestep enable 0',framestep=2,showinfo",
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
  } as never);
  const diagnostics = Buffer.concat(stderr).toString();
  assert.equal(result.exitCode, 0, diagnostics);
  assert.deepEqual(Buffer.concat(stdout), input);
  const frames = diagnostics.split("\n").filter(line => line.includes("pts:"));
  assert.equal(frames.length, 4, diagnostics);
  for (const [n, line] of frames.entries()) {
    assert.equal(Number(line.split("pts:")[1]!.trim().split(" ")[0]), n, line);
  }
  assert.deepEqual(volume.readFileSync("/in.raw"), input);
});
