import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [format, size, planes] of [
  ["yuv420p", "2x2", ["104080eb", "5a", "f0"]],
  ["yuv422p", "2x2", ["104080eb", "5a5a", "f0f0"]],
  ["yuv444p", "2x2", ["104080eb", "5a5a5a5a", "f0f0f0f0"]],
  ["yuv422p", "3x3", ["104080eb1122334455", "5a60708090a0", "f0e0d0c0b0a0"]],
  ["yuv444p", "3x3", ["104080eb1122334455", "5a60708090a0b0c0d0", "f0e0d0c0b0a0908070"]]
] as const) {
  const first = planes.map(hex => Buffer.from(hex, "hex"));
  const second = first.map(plane => plane.map(value => 255 - value));
  const frameBytes = first.reduce((sum, plane) => sum + plane.length, 0);
  for (const mode of ["numbered", "limited", "atomic", "first-budget", "second-budget"] as const) {
    it(`writes exact ${format} ${size} image2 planes (${mode})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.concat([...first, ...second]) });
      const maxOutputBytes = mode === "first-budget" ? frameBytes - 1
        : mode === "second-budget" ? frameBytes * 2 - 1 : frameBytes * 2;
      const start = mode === "limited" ? 7 : 1;
      const failedFrame = mode === "first-budget" ? 1 : mode === "second-budget" ? 2 : undefined;
      if (failedFrame !== undefined) {
        for (const suffix of ["Y", "U", "V"]) volume.writeFileSync(`/out0${failedFrame}.${suffix}`, "KEEP");
      }
      let stderr = "";
      const result = await createFfmpegCommand({ limits: { maxOutputBytes } }).execute({
        args: ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
          "-framerate", "2", "-i", "/in.raw", "-pix_fmt", format, "-c:v", "rawvideo", "-f", "image2",
          ...(mode === "limited" ? ["-start_number", "7", "-frames:v", "1"] : []),
          ...(mode === "atomic" ? ["-atomic_writing", "1"] : []), "/out%02d.Y"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); },
          async rename(from: string, to: string) { volume.renameSync(from, to); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (failedFrame !== undefined) {
        assert.notEqual(result.exitCode, 0);
        assert.match(stderr, /output.*limit|limit.*output/i);
        for (const suffix of ["Y", "U", "V"]) {
          assert.equal(volume.readFileSync(`/out0${failedFrame}.${suffix}`).toString(), "KEEP");
        }
      } else assert.equal(result.exitCode, 0, stderr);
      const count = failedFrame !== undefined ? failedFrame - 1 : mode === "limited" ? 1 : 2;
      for (const [index, frame] of [first, second].slice(0, count).entries()) {
        for (const [plane, suffix] of ["Y", "U", "V"].entries()) {
          assert.deepEqual(volume.readFileSync(`/out0${start + index}.${suffix}`), frame[plane]);
        }
      }
      assert.equal(volume.readdirSync("/").length, 1 + 3 * (count + (failedFrame === undefined ? 0 : 1)));
    });
  }
}
