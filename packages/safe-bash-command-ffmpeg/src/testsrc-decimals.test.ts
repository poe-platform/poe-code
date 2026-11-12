import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete RGB24 output hashes from native FFmpeg 7.0.2, including counter pixels.
for (const [options, hash, frames = 2] of [
  ["", "7aeba7a4a83102833467fade766895e8208e6ee98e482fbc5939ab55b96fbe8f"],
  [":n=0", "7aeba7a4a83102833467fade766895e8208e6ee98e482fbc5939ab55b96fbe8f"],
  [":decimals=1", "7ec9550f515279be2b1a52f75311a567f11dcad0f6d337855fe2b7e00e11dfbb"],
  [":n=1", "7ec9550f515279be2b1a52f75311a567f11dcad0f6d337855fe2b7e00e11dfbb"],
  [":decimals=2", "4b0fda20ed8303c36cc62225221e7cb5a0983b2a4afe3a9b1095bed52782209c"],
  [":n=2", "4b0fda20ed8303c36cc62225221e7cb5a0983b2a4afe3a9b1095bed52782209c"],
  [":n=1:decimals=2", "4b0fda20ed8303c36cc62225221e7cb5a0983b2a4afe3a9b1095bed52782209c"],
  [":decimals=2:n=1", "7ec9550f515279be2b1a52f75311a567f11dcad0f6d337855fe2b7e00e11dfbb"],
  [":decimals=1+1", "4b0fda20ed8303c36cc62225221e7cb5a0983b2a4afe3a9b1095bed52782209c"],
  [":decimals=1.5", "4b0fda20ed8303c36cc62225221e7cb5a0983b2a4afe3a9b1095bed52782209c"],
  [":decimals=9", "caa9ebe97802f353b4326e8eb95fdb861a2f492cc525e3f108acde096fd5024b"],
  [":decimals=10", "96380f9ad1b4630f205616c6d05c93a994a3fb7a81002499ce008fa8ac251171"],
  [":decimals=17", "96380f9ad1b4630f205616c6d05c93a994a3fb7a81002499ce008fa8ac251171"],
  // Truncate fractional counters, and scale before division to avoid 0.29 * 100 < 29.
  [":r=6:decimals=1", "b9a65638f80508d381e7cc13ae9b4d9d0360aecaef9a5b1a64aa3b57b4f21ed1", 6],
  [":r=100:d=0.3:decimals=2", "4234aa5e43c9c619dccaa6c8cdbdaf844221dfeb4065b43da6d634e192384ba2", 30]
] as const) {
  it(`renders native testsrc timestamp precision for ${options || "defaults"}`, async () => {
    const volume = Volume.fromJSON({});
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
        `testsrc=s=80x40:r=2:d=1${options}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stderr).length, 0);
    const bytes = Buffer.concat(stdout);
    assert.equal(bytes.length, frames * 80 * 40 * 3);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  });
}

for (const options of ["decimals=-1", "n=18", "decimals=nan", "n="]) {
  it(`rejects invalid testsrc precision ${options} without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/out.rgb": "keep" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=s=80x40:r=2:d=1:${options}`,
        "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.rgb"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(Buffer.concat(errors).toString().includes("testsrc:"));
    assert.equal(volume.readFileSync("/out.rgb", "utf8"), "keep");
  });
}
