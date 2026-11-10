import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Expected PCM slices were checked against native FFmpeg 7.0.2.
for (const complex of [false, true]) {
  for (const [bound, start, end] of [
    ["start_pts=9007199254740992", 12, 12],
    ["end_pts=9007199254740992", 0, 12],
    ["start_sample=9007199254740992", 12, 12],
    ["end_sample=9007199254740992", 0, 12],
    ["start_sample=9223372036854775807", 12, 12],
    ["end_sample=9223372036854775807", 0, 12],
    ["start_pts=9223372036854775808", 12, 12],
    ["end_pts=9223372036854775808", 0, 12],
    ["end_sample=9223372036854775808", 0, 12],
    ["end_sample=9223372036854776832", 0, 12],
    ["end_sample=9223372036854777856", -1, 0],
    ["start_pts=-9223372036854775808", 0, 12],
    ["end_pts=-9223372036854775808", 0, 12],
    ["end_pts=-9223372036854775807", 0, 12],
    ["end_pts=-9223372036854776832", 0, 12],
    ["end_pts=-9223372036854774784", 0, 0],
    ["end_pts=-9223372036854777856", -1, 0],
    ["end_pts=-8", 0, 0],
    ["end_pts=8:end_pts=-9223372036854775808", 0, 12],
    ["start_pts=8:start_pts=-9223372036854775808", 0, 12],
    ["end_pts=-9223372036854775808:end_sample=4", 0, 4],
    ["start_pts=9007199254740992:start_sample=4", 4, 12],
    ["end_sample=9007199254740992:end_pts=4", 0, 12],
    ["start_pts=2+2", 4, 12],
    ["end_pts=2.5", 0, 2],
    ["end_pts=3.5", 0, 4],
    ["start_pts=999999999999999999999", -1, 0],
    ["end_pts=-999999999999999999999", -1, 0],
    ["start_sample=999999999999999999999", -1, 0],
    ["end_sample=999999999999999999999", -1, 0],
    ["start_sample=-9223372036854775808", -1, 0],
    ["end_sample=-9223372036854775808", -1, 0]
  ] as const) {
    it(`atrim=${bound} handles native int64 bounds (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(24);
      for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `atrim=${bound}`;
      let stderr = "";
      const result = await createFfmpegCommand({ limits: { maxMemoryBytes: 65536 } }).execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
      if (start === -1) {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("atrim: invalid"), stderr);
        assert.equal(volume.existsSync("/out.raw"), false);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(start * 2, end * 2));
      }
    });
  }
}
