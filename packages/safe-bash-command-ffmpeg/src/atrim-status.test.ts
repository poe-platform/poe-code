import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Exit statuses and PCM checked against Linux FFmpeg 7.0.2.
for (const complex of [false, true]) {
  for (const [bound, exitCode] of [
    ["duration=-0.001", 222],
    ["durationi=-0.001", 222],
    ["end_sample=-1", 222],
    ["start_sample=-2", 222],
    ["end_sample=1e30", 222],
    ["start_pts=-1e30", 222],
    ["start_pts=Infinity", 222],
    ["start_pts=1/0", 222],
    ["duration=99999999999999999", 222],
    ["start_pts=invalid", 234],
    ["end_pts=0/0", 234],
    ["start_sample=", 234],
    ["duration=invalid", 234],
    ["end=", 234],
    ["end_sample=5:foo=1", 8],
    ["end_sample=5:enable=0", 176],
    ["end_sample=5", 0]
  ] as const) {
    for (const outputExists of [false, true]) {
      it(`atrim=${bound} returns ${exitCode} (${complex ? "complex" : "simple"}, output ${outputExists ? "exists" : "absent"})`, async () => {
        const input = Buffer.alloc(32);
        for (let i = 0; i < 16; i++) input.writeInt16LE(i + 1, i * 2);
        const existing = Buffer.from("existing output");
        const volume = Volume.fromJSON({ "/in.raw": input,
          ...(outputExists ? { "/out.raw": existing } : {}) });
        let stderr = "";
        const filter = `atrim=${bound}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
        assert.equal(result.exitCode, exitCode, stderr);
        if (exitCode === 0) assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(0, 10));
        else {
          assert.ok(stderr.includes("atrim:"), stderr);
          assert.equal(volume.existsSync("/out.raw"), outputExists);
          if (outputExists) assert.deepEqual(volume.readFileSync("/out.raw"), existing);
        }
      });
    }
  }
}
