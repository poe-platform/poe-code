import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 exits 8 for a missing filter, without touching the output.
for (const filter of ["nosuchfilter", "areverse,nosuchfilter", "areverse"]) {
  for (const graph of [false, true]) {
    for (const existing of [false, true]) {
      it(`${graph ? "complex" : "simple"} ${filter} with ${existing ? "existing" : "fresh"} output`, async () => {
        const volume = Volume.fromJSON(existing ? { "/out.bin": "existing" } : {});
        const input = Buffer.alloc(16);
        for (let i = 0; i < 8; i++) input.writeInt16LE(i + 1, i * 2);
        volume.writeFileSync("/in.raw", input);
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.bin"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        const stderr = Buffer.concat(errors).toString();
        if (filter === "areverse") {
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          const output = volume.readFileSync("/out.bin") as Buffer;
          assert.equal(output.length, 16);
          assert.deepEqual(Array.from({ length: 8 }, (_, i) => output.readInt16LE(i * 2)), [8, 7, 6, 5, 4, 3, 2, 1]);
        } else {
          assert.equal(result.exitCode, 8, stderr);
          assert.ok(stderr.includes("nosuchfilter"), stderr);
          if (existing) assert.equal(volume.readFileSync("/out.bin", "utf8"), "existing");
          else assert.equal(volume.existsSync("/out.bin"), false);
        }
      });
    }
  }
}
