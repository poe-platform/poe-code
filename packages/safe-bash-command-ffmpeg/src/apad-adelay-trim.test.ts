import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";


for (const complex of [false, true]) {
  for (const end of ["end_pts=12", "end_sample=12", "end=0.012"]) {
    for (const padding of ["packet_size=3", "packet_size=3:pad_len=20"]) {
      it(`apad=${padding},adelay=2S,atrim=${end} (${complex ? "complex" : "simple"})`, async () => {
        const samples = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
        const bytes = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, i) => bytes.writeInt16LE(sample, i * 2));
        const volume = Volume.fromJSON({ "/in.raw": bytes });
        const errors: Uint8Array[] = [];
        const filter = `apad=${padding},adelay=2S,atrim=${end}`;
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
        const actual = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: actual.length / 2 }, (_, i) => actual.readInt16LE(i * 2)),
          [0, 0, ...samples, 0, 0]);
      });
    }
  }
}
