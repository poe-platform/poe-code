import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const frame = (value: number) => Buffer.from([...Array<number>(4).fill(value), ...Array<number>(8).fill(128)]);
const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...[32, 52, 72, 92, 112, 132].flatMap(value => [Buffer.from("FRAME\n"), frame(value)])]);

// Native FFmpeg 7.0.2 rounds seeks to the nearest timebase tick, with ties upward.
for (const side of ["input", "output", "eof"]) {
  for (const filter of ["none", "simple", "graph"]) {
    for (const [seek, relative, expected] of [
      ["1.01", "-0.49", [112, 132]],
      ["1.124999", "-0.375001", [112, 132]],
      ["1.125", "-0.375", [132]],
      ["1.24", "-0.26", [132]],
      ["1.25", "-0.25", [132]],
      ["1.375", "-0.125", []]
    ] as const) {
      it(`${side} seek ${seek} rounds video timestamps with ${filter} filtering`, async () => {
        const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
        const seekArgs = side === "eof" ? ["-sseof", relative] : ["-ss", seek];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", ...(side === "output" ? [] : seekArgs), "-i", "/in.y4m",
            ...(filter === "none" ? [] : filter === "simple" ? ["-vf", "null"] : ["-filter_complex", "[0:v]null[v]", "-map", "[v]"]),
            ...(side === "output" ? seekArgs : []), "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat(expected.map(frame)));
        assert.deepEqual(volume.readFileSync("/in.y4m"), input);
      });
    }
  }
}
