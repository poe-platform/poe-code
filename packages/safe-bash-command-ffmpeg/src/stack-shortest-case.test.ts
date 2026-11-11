import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["hstack", "vstack", "xstack"]) {
  for (const [value, shortest] of [
    ["true", true], ["TRUE", true], ["TrUe", true],
    ["false", false], ["FALSE", false], ["FaLsE", false]
  ] as const) {
    for (const positional of [false, true]) {
      const options = positional
        ? filter === "xstack" ? `2:::${value}` : `2:${value}`
        : `shortest=${value}`;
      it(`${filter} honors ${options}`, async () => {
        const volume = Volume.fromJSON({
          "/a.gray": Buffer.from([10, 11, 20, 21, 30, 31]),
          "/b.gray": Buffer.from([100, 101, 110, 111])
        });
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error",
            "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/a.gray",
            "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x1", "-framerate", "2", "-i", "/b.gray",
            "-filter_complex", `[0:v][1:v]${filter}=${options}[out]`, "-map", "[out]",
            "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(data: Uint8Array) { stdout.push(data); } },
          stderr: { async write(data: Uint8Array) { stderr.push(data); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
        assert.equal(Buffer.concat(stdout).toString("hex"), shortest
          ? "0a0b646514156e6f"
          : "0a0b646514156e6f1e1f6e6f");
      });
    }
  }
}
