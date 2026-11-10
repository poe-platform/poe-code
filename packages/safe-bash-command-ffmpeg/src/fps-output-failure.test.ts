import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 opens rawvideo output before evaluating fps rates,
// but rejects invalid filter options before opening the destination.
const source = Buffer.from([20, 40, 60, 80, 100, 120]);
for (const existing of [false, true]) {
  for (const [filter, exitCode, output] of [
    ["fps=1/0", 234, ""],
    ["fps=0", 234, ""],
    ["fps=-1", 234, ""],
    ["fps=fps=bad", 234, ""],
    ["setpts=PTS,fps=5", 0, source],
    ["fps=2:round=bogus", 234, undefined],
    ["fps=2:eof_action=bogus", 234, undefined],
    ["fps=2:no_such_option=1", 8, undefined],
    ["fps=2:start_time=bogus", 234, undefined],
    ["fps=bad:round=bogus", 234, undefined],
    ["fps=bad:start_time=bogus", 234, undefined]
  ] as const) {
    it(`${filter} preserves native status and ${existing ? "existing" : "new"} rawvideo output`, async () => {
      const volume = Volume.fromJSON({ "/in.gray": source, ...(existing ? { "/out": "KEEP" } : {}) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "1x1", "-framerate", "5", "-i", "/in.gray", "-vf", filter,
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const expected = output ?? (existing ? "KEEP" : undefined);
      assert.equal(volume.existsSync("/out"), expected !== undefined, stderr);
      if (expected !== undefined) assert.deepEqual(volume.readFileSync("/out"), Buffer.from(expected), stderr);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.deepEqual(volume.readFileSync("/in.gray"), source);
    });
  }
}

for (const [overwrite, target, exitCode] of [
  [[], "/out", 1], [["-n"], "/out", 0], [["-y"], "/in.gray", 1],
  [["-y"], "pipe:1", 234], [["-y"], "/dev/null", 234]
] as const) {
  it(`invalid fps preserves overwrite and stream safeguards: ${overwrite} ${target}`, async () => {
    const volume = Volume.fromJSON({ "/in.gray": source, "/out": "KEEP" });
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", ...overwrite, "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "1x1", "-framerate", "5", "-i", "/in.gray", "-vf", "fps=1/0",
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", target],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile() { assert.fail("must not write a file"); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() { assert.fail("must not emit output"); } },
      stderr: { async write() {} }
    } as never);
    assert.equal(result.exitCode, exitCode);
    assert.equal(volume.readFileSync("/out", "utf8"), "KEEP");
    assert.deepEqual(volume.readFileSync("/in.gray"), source);
  });
}
