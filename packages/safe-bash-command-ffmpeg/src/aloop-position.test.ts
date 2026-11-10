import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static retains packet positions only on original aloop frames.
for (const complex of [false, true]) {
  for (const [filter, count, selected] of [
    ["aloop=loop=1:size=4,aselect='not(isnan(pos))'", 10, [0, 10]],
    ["aloop=loop=1:size=4,aselect='isnan(pos)'", 10, [0, 4]],
    ["aloop=loop=0:size=4,aselect='not(isnan(pos))'", 10, [0, 10]],
    ["aloop=loop=0:size=4,aselect='isnan(pos)'", 10, [0, 0]],
    ["anull,aselect='not(isnan(pos))'", 10, [0, 10]],
    ["anull,aselect='isnan(pos)'", 10, [0, 0]],
    ["asetnsamples=3:0,aloop=1:4,aselect='not(isnan(pos))'", 10, [0, 10]],
    ["aloop=1:4,aloop=0:14,aselect='isnan(pos)'", 10, [0, 0]],
    ["aloop=1:4,aselect='eq(pos,1024)'", 1200, [512, 1024]],
    ["aloop=1:4,aselect='eq(pos,2048)'", 1200, [1024, 1200]]
  ] as const) {
    it(`${filter} preserves source positions (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(count * 2);
      for (let i = 0; i < count; i++) input.writeInt16LE(count === 10 ? (i + 1) * 1000 : i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", count === 10 ? "1000" : "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(output), input.subarray(selected[0] * 2, selected[1] * 2));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
