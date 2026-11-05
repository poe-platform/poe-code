import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [expression, count] of [
  ["between(n,1,2)", 2], ["gt(n,1)", 2], ["eq(n,1)", 1],
  ["not(mod(n,2))", 2], ["eq(n,1)+eq(n,3)", 2],
  ["eq(n,1)*eq(n,3)", 0], ["gt(t,1.5)", 2], ["0", 0], ["1", 4],
  ["unknown(n)", null], ["eq(n,1)+unknown(n)", null],
  ["eq(n,1)junk", null], ["between(n,1)", null], ["not(n,1)", null],
  ["eq(n,1", null], ["scene", null]
] as const) {
  it(`select evaluates or rejects the entire expression ${expression}`, async () => {
    const volume = Volume.fromJSON({ "/out_1.png": "existing output" });
    const before = volume.toJSON();
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
        "-vf", `select='${expression}'`, "-fps_mode", "passthrough", "/out_%d.png"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    const stderr = Buffer.concat(errors).toString();
    if (count === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("select:"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else if (count === 0) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("No video frame"), stderr);
      assert.deepEqual(volume.toJSON(), before);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const written = Object.entries(volume.toJSON()).filter(([, value]) => value !== "existing output");
      assert.equal(written.length, count);
    }
  });
}
