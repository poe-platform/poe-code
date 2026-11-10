import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const levels = [20, 50, 65, 100, 140, 170, 180, 205, 221];
// Native FFmpeg 7.0.2 results, including complete and partial decimation cycles.
for (const [count, filter, indices, sha256] of [
  [9, "decimate=cycle=4,fps=10", [1, 1, 2, 3, 5, 5, 6, 7], "3b0cd21388d2ee0df0d0c72f55b71a17abd1a31a28cfd62a6682988d2a69756f"],
  [9, "decimate=cycle=4,fps=15", [1, 1, 2, 2, 3, 3, 5, 5, 6, 6, 7, 7], "acb24032b29d616e473c84bec38ce8301159035b4bb85bb88b2f5365021f3c03"],
  [8, "decimate=cycle=4,fps=10", [1, 1, 2, 3, 5, 5, 6], "b13eb0f1e8235ef7e6b87a1153687bbbeac1cb2fe009fca1ae5694c7978730dd"],
  [9, "decimate=cycle=4", [1, 2, 3, 5, 6, 7, 8], "a1ab13a22cc753d5421dea0e35a946885b80eca54c6c8ce78de952696b2224c9"],
  [9, "fps=10", [0, 1, 2, 3, 4, 5, 6, 7, 8], "0125ab102873c09947c30f9eb4ba4964e2a35c40243a2c0bd53752b7812f87f0"]
] as const) {
  it(`matches native EOF for ${count} frames through ${filter}`, async () => {
    const frames = levels.slice(0, count).map(level => Buffer.concat([
      Buffer.alloc(32 * 32, level), Buffer.alloc(32 * 32 * 2, 128)
    ]));
    const volume = Volume.fromJSON({
      "/in.y4m": Buffer.concat([
        Buffer.from("YUV4MPEG2 W32 H32 F10:1 Ip A1:1 C444\n"),
        ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])
      ]),
      "/out.raw": "KEEP"
    });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, indices.length * 32 * 32 * 3);
    assert.deepEqual(output, Buffer.concat(indices.map(index => frames[index]!)));
    assert.equal(createHash("sha256").update(output).digest("hex"), sha256);
  });
}
