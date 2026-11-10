import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(20);
for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);

// Native FFmpeg 7.0.2 compares atrim PTS bounds in sample units even after asettb.
for (const complex of [false, true]) {
  for (const [denominator, trim, start, end] of [
    [2000, "end_pts=8", 0, 8],
    [2000, "start_pts=4", 4, 10],
    [500, "start_pts=4", 3, 10],
    [1000, "end_pts=8", 0, 8],
    [2000, "end_sample=8", 0, 8]
  ] as const) {
    it(`atrim=${trim} after asettb=1/${denominator} (${complex ? "complex" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=n=3:p=0,asettb=1/${denominator},atrim=${trim}`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), input.subarray(start * 2, end * 2));
    });
  }
}
