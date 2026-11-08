import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["f64le", "s32le"]) {
  const values = format === "f64le"
    ? [0.5 + 2 ** -34, -0.5 - 2 ** -34]
    : [16777217, -16777217, 33554433, -33554433];
  const width = format === "f64le" ? 8 : 4;
  const input = Buffer.alloc(values.length * width);
  values.forEach((value, i) => {
    if (format === "f64le") input.writeDoubleLE(value, i * width);
    else input.writeInt32LE(value, i * width);
  });
  for (const filter of [undefined, "anull", "areverse"]) {
    it(`preserves exact ${format} samples through ${filter ?? "no filter"}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", format, "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(filter ? ["-af", filter] : []), "-c:a", `pcm_${format}`, "-f", format, "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const expected = filter === "areverse"
        ? Buffer.concat(values.map((_, i) => input.subarray(i * width, (i + 1) * width)).reverse())
        : input;
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
    });
  }
}
