import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(4096 * 2);
for (let i = 0; i < 4096; i++) input.writeInt16LE(((i % 32) - 16) * 800, i * 2);

// Native FFmpeg 7.0.2, mono s16le at 8000 Hz. Tempo output advances by
// emitted samples even when asetpts introduces gaps in the input timeline.
for (const graph of [false, true]) {
  for (const [filter, format, count, hash, offset] of [
    ["asetpts=2*PTS,atempo=1,aselect=lt(t\\,0.25)", "s16le", 2048, "f61092627006577921c7b7bf99182b6fde465a25eff9b50a490348c9e217c6dc", 0],
    ["asetpts=2*PTS,atempo=1", "framecrc", 4096, "", 0],
    ["atempo=1,aselect=lt(t\\,0.25)", "s16le", 2048, "f61092627006577921c7b7bf99182b6fde465a25eff9b50a490348c9e217c6dc", 0],
    ["asetpts=2*PTS,aselect=lt(t\\,0.25)", "s16le", 1024, "e5d45ea1a7eab9a48492eb71dbd9732a4c1a2635107c7842ff652ed0a3ad42e3", 0],
    ["asetpts=2*PTS,atempo=1", "s16le", 4096, "35968d68139814ab46248bd1e468da81e82d2e977a1c9f6cbfcc0078e45c6c6e", 0],
    ["asetpts=PTS+8000,atempo=1", "framecrc", 4096, "", 8000],
    ["asetpts=2*PTS+8000,atempo=1", "framecrc", 4096, "", 8000],
    ["asettb=1/700,asetpts=2*PTS+700,atempo=1", "framecrc", 4096, "", [8000, 8514, 9029, 9531, 10046, 10560, 11074, 11589]]
  ] as const) {
    it(`atempo timing: ${filter} to ${format} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", format, "/out"],
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
      const output = volume.readFileSync("/out") as Buffer;
      if (format === "s16le") {
        assert.equal(output.length / 2, count);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      } else {
        assert.ok(output.toString().includes("#tb 0: 1/8000"));
        const rows = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
          .map(line => line.split(",").map(field => field.trim()));
        assert.deepEqual(rows, Array.from({ length: count / 512 }, (_, i) => {
          const pts = String(typeof offset === "number" ? offset + i * 512 : offset[i]);
          return ["0", pts, pts, "512", "1024", i === 7 ? "0x2388e4d1" : "0x70a4ed93"];
        }));
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
