import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["hstack", "vstack"]) {
  for (const branch of ["", "hflip", "trim=end_frame=1"]) {
    for (const shortest of [0, 1]) {
      it(`${filter} resolves ${branch || "direct inputs"} with shortest=${shortest}`, async () => {
        const volume = Volume.fromJSON({
          "/a.raw": Buffer.from([1, 2, 3, 4, 10, 20, 30, 40, 50, 60, 70, 80]),
          "/b.raw": Buffer.from([5, 6, 7, 8, 55, 66, 77, 88])
        });
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const graph = `${branch ? `[1:v]${branch}[b];` : ""}[0:v][${branch ? "b" : "1:v"}]${filter}=shortest=${shortest}[out]`;
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "1", "-i", "/a.raw",
            "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-r", "1", "-i", "/b.raw",
            "-filter_complex", graph, "-map", "[out]", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
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
        const frames = filter === "hstack"
          ? branch === "hflip"
            ? ["0102060503040807", "0a1442371e28584d", "323c42374650584d"]
            : branch ? ["0102050603040708", "0a1405061e280708", "323c050646500708"]
              : ["0102050603040708", "0a1437421e284d58", "323c374246504d58"]
          : branch === "hflip"
            ? ["0102030406050807", "0a141e284237584d", "323c46504237584d"]
            : branch ? ["0102030405060708", "0a141e2805060708", "323c465005060708"]
              : ["0102030405060708", "0a141e2837424d58", "323c465037424d58"];
        assert.equal(Buffer.concat(stdout).toString("hex"), frames.slice(0, shortest ? branch.startsWith("trim") ? 1 : 2 : 3).join(""));
      });
    }
  }
}
