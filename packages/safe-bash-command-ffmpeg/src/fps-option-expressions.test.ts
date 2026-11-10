import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(options: string) {
  const fs = Volume.fromJSON({ "/out": "KEEP" });
  fs.writeFileSync("/in.gray", Buffer.from([20, 40, 60, 80, 100, 120]));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
      "-video_size", "1x1", "-framerate", "5", "-i", "/in.gray", "-vf", `fps=${options}`,
      "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: fs.readFileSync("/out") as Buffer };
}

// Exact grayscale output from native FFmpeg 7.0.2, including integer-option ties to even.
for (const [options, expected] of [
  ["3:round=2+1", [20, 40, 80, 120]],
  ["3:round=2.5", [40, 80, 100]],
  ["2:eof_action=pass-1", [40, 80]],
  ["2:eof_action=0.6", [40, 80, 120]],
  ["2:eof_action=1/2", [40, 80]],
  ["3:round=4", []],
  ["3:round=up", [20, 40, 80, 120]],
  ["3:round=down", [40, 80, 100]],
  ["2:eof_action=pass", [40, 80, 120]],
  ["2:eof_action=round", [40, 80]],
  ["3:round=near-2", [20, 40, 80, 120]],
  ["3:0:2+1:pass-1", [20, 40, 80, 120]],
  ["3:round=3.5", []],
  ["3:round=4.5", []],
  ["3:round=4:eof_action=pass", []]
] as const) {
  it(`fps=${options} matches native destination bytes`, async () => {
    const { result, stderr, output } = await run(options);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual([...output], expected);
  });
}

for (const option of [
  "round=-0.1", "round=5.1", "round=6", "round=pass", "round=1/0", "round=0/0", "round=",
  "eof_action=-0.1", "eof_action=1.1", "eof_action=2", "eof_action=near", "eof_action=1+", "eof_action="
]) {
  it(`fps rejects ${option} before replacing output`, async () => {
    const { result, stderr, output } = await run(`3:${option}`);
    assert.notEqual(result.exitCode, 0, stderr);
    assert.ok(stderr.includes("fps:"), stderr);
    assert.equal(output.toString(), "KEEP");
  });
}
