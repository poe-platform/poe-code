import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import type { MediaResourceLimits } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static, ten mono s16le samples at 1 kHz.
for (const graph of [false, true]) {
  for (const [loop, downstream, count, offset, frames = 4, limits] of [
    [-1, "asetnsamples=n=6:p=0", 24, 0],
    [-1, "aselect=not(mod(n\\,2))", 16, 0],
    [-1, "atrim=start_sample=6", 14, 2],
    [-1, "anull", 16, 0],
    [12, "asetnsamples=n=6:p=0", 24, 0],
    [-1, "aselect=not(mod(n\\,2)),asetnsamples=n=6:p=0", 24, 0],
    [-1, "atrim=start_sample=6,asetnsamples=n=6:p=0", 24, 2],
    [-1, "asetnsamples=n=6:p=0,atrim=start_sample=6", 24, 2],
    [-1, "atrim=end_sample=10,asetnsamples=n=6:p=0", 10, 0],
    [-1, "atrim=end_sample=12,aselect=0", 0, 0],
    [-1, "asetnsamples=n=6:p=0", 0, 0, 0],
    [-1, "aselect=0", null, 0, 4, { maxSamplesPerTrack: 20 }],
    [-1, "aselect=0", null, 0, 4, { maxDurationSeconds: 0.02 }],
    [-1, "asetnsamples=n=1000", null, 0, 4, { maxSamplesPerTrack: 20 }]
  ] as readonly (readonly [number, string, number | null, number, number?, MediaResourceLimits?])[]) {
    it(`aloop=${loop} bounds ${frames} output frames after ${downstream} (limit=${JSON.stringify(limits)}) (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(20);
      for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `asetnsamples=n=3:p=0,aloop=loop=${loop}:size=4,${downstream}`;
      let stderr = "";
      const result = await createFfmpegCommand({ limits }).execute({
        args: ["-y", "-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-frames:a", String(frames), "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (count === null) {
        assert.notEqual(result.exitCode, 0, stderr);
        assert.ok(stderr.includes("limit"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const expected = Buffer.alloc(count * 2);
        for (let i = 0; i < count; i++) expected.writeInt16LE(((i + offset) % 4 + 1) * 1000, i * 2);
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
