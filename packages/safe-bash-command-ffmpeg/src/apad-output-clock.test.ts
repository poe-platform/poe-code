import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 10 }, (_, index) => (index + 1) * 1000);
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// PCM output captured with native FFmpeg 7.0.2.
for (const graph of [false, true]) {
  for (const [clock, count] of [
    ["asetpts=PTS/2", 27], ["asetrate=2000", 28], ["asetpts=PTS/3", 41],
    ["asetrate=2000,asetpts=PTS/2", 55], ["asetpts=PTS/2,asetrate=2000", 55],
    ["asetpts=N/2", 27]
  ] as const) {
    for (const padding of ["", ":pad_len=64"]) {
      it(`apad${padding} fills output duration after ${clock} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=3:p=0,apad=packet_size=2${padding},${clock}`;
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-t", "0.014", "-f", "s16le", "-"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = Buffer.concat(chunks);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
          [...samples, ...Array(count - samples.length).fill(0)]);
      });
    }
  }
}

for (const clock of ["asetpts=0", "asetpts=PTS/100", "asetpts=NAN"]) {
  it(`bounds padding resources after ${clock} without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.02 } }).execute({
      args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
        "-af", `asetnsamples=n=3:p=0,apad=packet_size=2,${clock}`, "-t", "0.014", "-f", "s16le", "/out.raw"],
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
