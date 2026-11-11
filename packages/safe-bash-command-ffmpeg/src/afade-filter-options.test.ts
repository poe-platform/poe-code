import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [options, valid] of [
    ["", true],
    [":threads=1", true],
    [":thread_type=slice", true],
    [":extra_hw_frames=1", true],
    [":threads=0:thread_type=0:extra_hw_frames=-1", true],
    [":threads=1:thread_type=slice:extra_hw_frames=1", true],
    [":threads=1+1:extra_hw_frames=2-1", true],
    [":thread_type=+slice", true],
    [":thread_type=-slice", true],
    [":thread_type=4294967295", true],
    [":threads=-1", false],
    [":threads=all", false],
    [":threads=2147483648", false],
    [":threads=", false],
    [":threads=0/0", false],
    [":thread_type=bogus", false],
    [":thread_type=", false],
    [":thread_type=0.5", false],
    [":thread_type=4294967296", false],
    [":extra_hw_frames=-2", false],
    [":extra_hw_frames=2147483648", false],
    [":unknown=1", false]
  ] as const) {
    for (const outputExists of [false, true]) {
      it(`afade=ns=8${options} (${complex ? "complex" : "simple"}, output ${outputExists ? "exists" : "absent"})`, async () => {
        const input = Buffer.alloc(32);
        for (let i = 0; i < 16; i++) input.writeInt16LE(i % 2 === 0 ? 12000 : -12000, i * 2);
        const existing = Buffer.from("existing output");
        const volume = Volume.fromJSON({ "/in.raw": input,
          ...(outputExists ? { "/out.raw": existing } : {}) });
        let stderr = "";
        const filter = `afade=ns=8${options}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ac", "1", "-ar", "8000", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (valid) {
          assert.equal(result.exitCode, 0, stderr);
          const output = volume.readFileSync("/out.raw") as Buffer;
          assert.equal(output.length, 32);
          // FFmpeg 7.0.2 renders these samples for the control and every valid option.
          assert.deepEqual(Array.from({ length: 16 }, (_, i) => output.readInt16LE(i * 2)),
            [0, -1500, 3000, -4500, 6000, -7500, 9000, -10500,
              12000, -12000, 12000, -12000, 12000, -12000, 12000, -12000]);
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes("afade:"), stderr);
          assert.equal(volume.existsSync("/out.raw"), outputExists);
          if (outputExists) assert.deepEqual(volume.readFileSync("/out.raw"), existing);
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}

for (const complex of [false, true]) {
  for (const key of ["threads", "thread_type", "extra_hw_frames"]) {
    for (const value of ["default", "min", "max", "none", "all"]) {
      it(`afade ${key}=${value} matches native PCM (${complex ? "complex" : "simple"})`, async () => {
        const input = Buffer.from("803e".repeat(8), "hex");
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const filter = `afade=ns=4:${key}=${value}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (key === "threads" && value === "all") {
          assert.notEqual(result.exitCode, 0);
          assert.match(stderr, /afade:/);
          assert.equal(Buffer.concat(stdout).length, 0);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          // Native FFmpeg's exact s16le output for every accepted named constant.
          assert.equal(Buffer.concat(stdout).toString("hex"), "0000a00f401fe02e803e803e803e803e");
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
