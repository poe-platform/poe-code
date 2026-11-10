import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [bounds, count] of [
    ["0:0.00025:2:4:0.000375:4:8", 8],
    ["0:0.00025:2:4", 4],
    ["0:0.00025", 2],
    ["start=0:end=0.00025:start_pts=2:end_pts=4:duration=0.000375:start_sample=4:end_sample=8", 8],
    ["0:0.00025:2:4:0.00075", 6],
    ["0:0.00025:2:4:0.000375:4", 4]
  ] as const) {
    it(`atrim=${bounds} preserves positional bounds through ${complex ? "-filter_complex" : "-af"}`, async () => {
      const input = Buffer.alloc(24);
      for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const filter = `atrim=${bounds}`;
      const result = await createFfmpegCommand().execute({
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
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(0, count * 2));
    });
  }
}
