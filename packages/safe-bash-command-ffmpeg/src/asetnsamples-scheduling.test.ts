import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [option, exitCode] of [
    ["", 0], ["threads=1", 0], ["thread_type=slice", 0], ["extra_hw_frames=1", 0],
    ["threads=0:thread_type=0:extra_hw_frames=-1", 0],
    ["threads=-1", 222], ["extra_hw_frames=-2", 222],
    ["thread_type=0.5", 222], ["threads=invalid", 234],
    ["extra_hw_frames=2147483648", 222]
  ] as const) {
    it(`asetnsamples scheduling ${option || "default"} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(22);
      for (let i = 0; i < 11; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=n=4${option ? `:${option}` : ""}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
      if (exitCode === 0) assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([input, Buffer.alloc(2)]));
      else assert.equal(volume.existsSync("/out.raw"), false);
    });
  }
}
