import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: -f FORMAT -ar 8000 -ac 1 -i in.raw -af FILTER -f s16le out.raw.
// Both byte orders decode to the same samples; volume negotiates float samples.
for (const format of ["s16be", "s16le"]) {
  for (const [filter, firstSample, hash] of [
    ["atempo=1", -12799, "35968d68139814ab46248bd1e468da81e82d2e977a1c9f6cbfcc0078e45c6c6e"],
    ["anull", -12800, "a59b8f835eb5a32a97da579d68054766a9b643daa055d944b44e53313af097a9"],
    ["volume=1,atempo=1", -12800, "9ea10fbd4bf8d27e11622a32e77cac9ca648dab7dfff88ce3cb0839001268c43"]
  ] as const) {
    for (const graph of [false, true]) {
      it(`matches native ${format} precision through ${filter} (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.alloc(4096 * 2);
        for (let i = 0; i < 4096; i++) {
          const sample = ((i % 32) - 16) * 800;
          if (format === "s16be") input.writeInt16BE(sample, i * 2);
          else input.writeInt16LE(sample, i * 2);
        }
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", format, "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 4096 * 2);
        assert.equal(output.readInt16LE(0), firstSample);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      });
    }
  }
}
