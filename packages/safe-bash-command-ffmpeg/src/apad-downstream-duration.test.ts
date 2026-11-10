import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1, 2, 3, 4, 5, 6, 7, 8];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// Exact PCM output reported with native FFmpeg 7.0.2.
for (const graph of [false, true]) {
  for (const padding of ["", ":pad_len=2048"]) {
    for (const [downstream, retained, count] of [
      ["atrim=start_sample=5", [6, 7, 8], 32],
      ["atrim=start_sample=5:end_sample=20", [6, 7, 8], 15],
      ["aselect=not(mod(n\\,2))", samples, 32],
      ["atrim=start_sample=5,aselect=not(mod(n\\,2))", [6, 7, 8], 32],
      ["aselect=not(mod(n\\,2)),atrim=start_sample=5", [6, 7, 8], 32]
    ] as const) {
      it(`apad${padding} fills output duration after ${downstream} and asetpts (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `apad=packet_size=64${padding},${downstream},asetpts=N/SR/TB`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-t", "0.004", "-f", "s16le", "/out.raw"],
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
        const expected = Buffer.alloc(count * 2);
        retained.forEach((sample, index) => expected.writeInt16LE(sample, index * 2));
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      });
    }
  }
}

for (const downstream of ["aselect=0", "atrim=start_sample=1000"]) {
  it(`bounds padding after ${downstream} and asetpts without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.02 } }).execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `apad=packet_size=64,${downstream},asetpts=N/SR/TB`, "-t", "0.004", "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("maxDurationSeconds"), stderr);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}
