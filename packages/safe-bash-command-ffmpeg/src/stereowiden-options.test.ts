import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const option of ["", "enable=1", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=1:thread_type=slice:extra_hw_frames=1",
    "threads=-1", "threads=2147483648", "threads=", "thread_type=bogus", "extra_hw_frames=-2", "unknown=1"]) {
    it(`handles stereowiden ${option || "defaults"} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(288);
      for (let i = 0; i < 72; i++) {
        input.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
        input.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
      const filter = `asetnsamples=n=8:p=0,stereowiden${option ? `=${option}` : ""}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = volume.readFileSync("/out");
      if (["threads=-1", "threads=2147483648", "threads=", "thread_type=bogus", "extra_hw_frames=-2", "unknown=1"].includes(option)) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(output.toString(), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(output.length, 288);
        // Native FFmpeg 7.0.2 output for the same PCM fixture and filter chain.
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "9263ac1412a07fdec66b24cea6c530f671367e8c1db162a0f17889ee6c42f5ea");
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
