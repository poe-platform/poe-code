import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: repeat the first four samples, stopping at sample 15.
for (const graph of [false, true]) {
  for (const [consumer, gain] of [
    ["atrim=end_sample=15", 1],
    ["anull,atrim=end_sample=15", 1],
    ["volume=1,atrim=end_sample=15", 1],
    ["acopy,atrim=end_sample=15", 1],
    ["anull@pass,volume@gain=1,acopy,atrim@stop=end_sample=15", 1],
    ["volume=0.5,atrim=end_sample=15", 0.5],
    ["anull", null],
    ["anull,atempo=2,atrim=end_sample=15", null]
  ] as const) {
    it(`bounds aloop with ${consumer} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(20);
      for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `asetnsamples=n=3:p=0,aloop=loop=-1:size=4,${consumer}`;
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-y",
          "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", graph || gain === null ? "/out.raw" : "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (gain === null) {
        assert.equal(result.exitCode, 1);
        assert.ok(stderr.includes("aloop: a finite consumer limit is required"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const expected = Buffer.alloc(30);
        for (let i = 0; i < 15; i++) expected.writeInt16LE((i % 4 + 1) * 1000 * gain, i * 2);
        assert.deepEqual(graph ? volume.readFileSync("/out.raw") : Buffer.concat(stdout), expected);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
