import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "c8b4a08c0a0a0a0a0a0a0a0a0a0a0a0a";
const halfDecay = "c8b4a08c645a5046322d282319161412";

// Native FFmpeg 7.0.2 reference bytes, with fresh AVExpr state per option.
for (const [options, expected] of [
  ["decay=none", input],
  ["decay=ld(0)", input],
  ["decay=st(0\\,0.5)", halfDecay],
  ["decay=randomi(0\\,0.5\\,0.5)", halfDecay],
  ["decay=0", input],
  ["decay=0.5", halfDecay],
  ["decay='st(0,0.5);ld(0)'", halfDecay],
  ["decay='random(0)*0+0.5'", halfDecay],
  ["decay='st(0,0.5)':decay=ld(0)", input]
] as const) {
  it(`evaluates lagfun ${options} with native frame bytes`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "2x2", "-framerate", "1", "-i", "/in.raw",
        "-vf", `lagfun=${options}`, "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    assert.equal(volume.readFileSync("/in.raw").toString("hex"), input);
  });
}
