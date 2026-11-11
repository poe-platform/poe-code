import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses and complete rawvideo output.
for (const [option, status, hex] of [
  ["decay=2", 222, ""],
  ["planes=0.5", 222, ""],
  ["q=1", 8, ""],
  ["decay=q", 234, ""],
  ["decay=1", 0, "c8b4a08cc8b4a08cc8b4a08cc8b4a08c"]
] as const) {
  it(`matches native lagfun=${option} status and raw frame bytes`, async () => {
    const input = Buffer.from("c8b4a08c0a0a0a0a0a0a0a0a0a0a0a0a", "hex");
    const volume = Volume.fromJSON({ "/in.raw": input });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
        "-framerate", "1", "-i", "/in.raw", "-vf", `lagfun=${option}`,
        "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout.push(data); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, status, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), hex);
    if (status === 0) assert.equal(stderr, "");
    else assert.ok(stderr.includes("lagfun:"), stderr);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
