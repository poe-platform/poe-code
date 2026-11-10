import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM measured with FFmpeg 7.0.2; finite repeats are the passing controls.
for (const [downstream, count] of [
  ["asetpts=PTS/2", 22], ["asetrate=2000", 24],
  ["asetrate=2000,asetpts=PTS/2", 46], ["asetpts=PTS/2,asetrate=2000", 46],
  ["asetpts=N/2", 22], ["anull,asetpts=PTS/2,acopy,volume=1:precision=fixed", 22]
] as const) {
  for (const repeats of [-1, 12]) {
    for (const graph of [false, true]) {
      for (const durationOption of ["-t", "-to"]) {
        it(`aloop=${repeats} follows ${downstream} with ${durationOption} (${graph ? "graph" : "simple"})`, async () => {
          const input = Buffer.alloc(20);
          for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
          const volume = Volume.fromJSON({ "/in.raw": input });
          const filter = `asetnsamples=n=3:p=0,aloop=loop=${repeats}:size=4,${downstream}`;
          const chunks: Buffer[] = [];
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
              ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              durationOption, "0.012", "-f", "s16le", "-"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          const expected = Buffer.alloc(count * 2);
          for (let i = 0; i < count; i++) expected.writeInt16LE((i % 4 + 1) * 1000, i * 2);
          assert.deepEqual(Buffer.concat(chunks), expected);
        });
      }
    }
  }
}

for (const downstream of ["asetpts=0", "asetpts=PTS/100", "asetpts=NAN"]) {
  it(`bounds loop resources after ${downstream} without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.alloc(20), "/out.raw": "KEEP" });
    const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.02 } }).execute({
      args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=3:p=0,aloop=loop=-1:size=4,${downstream}`, "-t", "0.012", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}
