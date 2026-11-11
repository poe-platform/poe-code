import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 16 }, (_, index) => index + 1);
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// Native FFmpeg 7.0.2: each spelling cuts at sample 8 (1 ms at 8 kHz).
for (const timestamp of [String.raw`'00\:00\:00.001'`, "1ms"]) {
  for (const prefix of [true, false]) {
    it(`routes the asegment ${timestamp} ${prefix ? "prefix" : "suffix"}`, async () => {
      const graph = `[0:a]asegment=timestamps=${timestamp}[b0][b1];` +
        (prefix ? "[b1]anullsink;[b0]anull[out]" : "[b0]anullsink;[b1]anull[out]");
      const volume = Volume.fromJSON({});
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "1",
          "-i", "pipe:0", "-filter_complex", graph, "-map", "[out]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
        prefix ? samples.slice(0, 8) : samples.slice(8));
    });
  }
}
