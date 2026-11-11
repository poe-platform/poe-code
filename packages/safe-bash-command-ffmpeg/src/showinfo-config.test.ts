import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7 reports link timing before frame rows; framestep changes only the rate.
for (const [rate, filter, timeBase, frameRate, selected] of [
  ["6", "null,showinfo", "1/6", "6/1", [0, 1, 2]],
  ["6", "framestep=2,showinfo", "1/6", "3/1", [0, 2]],
  ["6", "framestep=2,showinfo=checksum=0", "1/6", "3/1", [0, 2]],
  ["30000/1001", "framestep=2,showinfo", "1001/30000", "15000/1001", [0, 2]],
  ["6", "fps=3,showinfo", "1/3", "3/1", [0, 2]],
  ["6", "framestep=2,trim=end_frame=0,showinfo", "1/6", "3/1", []],
] as const) {
  for (const graph of [false, true]) {
    it(`reports showinfo configuration for ${filter} at ${rate} fps (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from(Array.from({ length: 12 }, (_, i) => 13 + 7 * i));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", rate, "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(output), Buffer.concat(selected.map(i => input.subarray(i * 4, i * 4 + 4))));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      const lines = stderr.trim().split("\n");
      assert.deepEqual(lines.slice(0, 2), [
        `[showinfo] config in time_base: ${timeBase}, frame_rate: ${frameRate}`,
        "[showinfo] config out time_base: 0/0, frame_rate: 0/0"
      ]);
      assert.equal(lines.length, selected.length + 2, stderr);
      for (let n = 0; n < selected.length; n++) {
        const pts = filter.startsWith("fps=") ? n : selected[n];
        assert.ok(lines[n + 2]!.startsWith(`[showinfo] n:${n} pts:${pts} `), stderr);
      }
    });
  }
}

for (const level of ["quiet", "error", "warning"]) {
  it(`suppresses showinfo configuration at ${level} log level`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.alloc(4, 13) });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", level, "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "6", "-i", "/in.raw",
        "-vf", "showinfo", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
  });
}
