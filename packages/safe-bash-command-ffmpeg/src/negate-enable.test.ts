import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "113a638cb5de07305982abd4fd264f78a1caf31c456e97c0";
const negated = "eec59c734a21f8cfa67d542b02d9b0875e350ce3ba91683f";

// FFmpeg 7 enables timelines when abs(result) >= 0.5; NaN bypasses the filter.
for (const [expression, expected] of [
  ["0/0", input],
  ["NAN", input],
  ["1/0", negated],
  ["-1/0", negated],
  ["INF", negated],
  ["-INF", negated],
  ["isnan(0/0)", negated],
  ["isinf(1/0)", negated],
  ["abs(NAN)", input],
  ["abs(-INF)", negated],
  ["0", input],
  ["1", negated],
  ["0.25", input],
  ["-0.5", negated],
  ["n/0", input.slice(0, 24) + negated.slice(24)],
  ["unknown", null],
  ["NAN+", null],
  ["isnan(0/0", null]
] as const) {
  it(`matches FFmpeg negate enable=${expression}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "preserved" });
    volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
        "-s", "2x2", "-r", "1", "-i", "/in.raw",
        "-vf", `negate=enable=${expression}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (expected === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes("negate enable: invalid"));
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "preserved");
    } else {
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    }
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
  });
}
