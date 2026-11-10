import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [prefix, start, offset, key] of [["", 0, 0, "lavfi.signalstats.YMIN"], ["setpts=PTS+4,", 0, 4, "lavfi.signalstats.YMIN"], ["trim=start_frame=3,", 3, 0, "lavfi.signalstats.YMIN"], ["", 0, 0, "missing"]] as const) {
  for (const mode of ["mode=print", "mode=4", "4", "mode=3"]) {
    it(`handles video metadata ${mode} ${prefix}${key} without changing frame bytes`, async () => {
      const luma = [[16, 16, 16, 16], [16, 16, 16, 32], [16, 16, 16, 16],
        [200, 200, 200, 200], [200, 200, 200, 200], [200, 200, 200, 200],
        [80, 80, 80, 80], [16, 16, 16, 16]];
      const frames = luma.map(values => Buffer.from([...values, ...Array<number>(8).fill(128)]));
      const volume = Volume.fromJSON({
        "/in.y4m": Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
          ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]),
        "/o.raw": "KEEP"
      });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-y", "-i", "in.y4m", "-vf",
          `${prefix}signalstats,metadata=${mode}:key=${key}`,
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
      if (mode === "mode=3") {
        assert.equal(result.exitCode, 1);
        assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/o.raw"), Buffer.concat(frames.slice(start)));
      assert.equal(stderr, key === "missing" ? "" : luma.slice(start).map((values, index) =>
        `frame:${String(index).padEnd(4)} pts:${String(index + start + offset).padEnd(7)} pts_time:${(index + start + offset) / 4}\nlavfi.signalstats.YMIN=${Math.min(...values)}\n`
      ).join(""));
    });
  }
}
