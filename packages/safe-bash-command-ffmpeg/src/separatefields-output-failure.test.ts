import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 opens file output before configuring field height,
// but rejects malformed filter options before opening the destination.
for (const existing of [false, true]) {
  for (const [height, filter, expected] of [
    [3, "separatefields,showinfo", ""],
    [2, "separatefields,showinfo", "1b220d14"],
    [3, "separatefields=1,showinfo", undefined],
    [3, "separatefields=unknown=1,showinfo", undefined]
  ] as const) {
    it(`${filter} on 2x${height} preserves native ${existing ? "existing" : "new"} output behavior`, async () => {
      const input = Buffer.from("0d141b222930", "hex").subarray(0, height * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, ...(existing ? { "/out.raw": "KEEP" } : {}) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", `2x${height}`, "-r", "2", "-i", "/in.raw", "-vf", filter,
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "-y", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() { assert.fail("must not emit stdout"); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === undefined) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.existsSync("/out.raw"), existing);
        if (existing) assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(volume.existsSync("/out.raw"), true, stderr);
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected, stderr);
        assert.equal(result.exitCode, height === 3 ? 183 : 0, stderr);
        if (height === 3) assert.ok(stderr.includes("separatefields: height must be even"), stderr);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}

for (const [overwrite, target, muxer, exitCode] of [
  [[], "/out.raw", "rawvideo", 1],
  [["-n"], "/out.raw", "rawvideo", 0],
  [["-y"], "/in.raw", "rawvideo", 1],
  [["-y"], "pipe:1", "rawvideo", 183],
  [["-y"], "/dev/null", "rawvideo", 183],
  [["-y"], "/out.raw", "null", 183],
  [["-y"], "/frame%02d.pgm", "image2", 183]
] as const) {
  it(`odd-height separatefields respects output safeguards: ${overwrite} ${target} (${muxer})`, async () => {
    const input = Buffer.from("0d141b222930", "hex");
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", ...overwrite, "-f", "rawvideo", "-pix_fmt", "gray",
        "-s", "2x3", "-r", "2", "-i", "/in.raw", "-vf", "separatefields,showinfo",
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", muxer, target],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile() { assert.fail("must not write a file"); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() { assert.fail("must not emit stdout"); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
