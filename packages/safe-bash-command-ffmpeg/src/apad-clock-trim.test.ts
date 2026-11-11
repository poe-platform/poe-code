import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

// Exact PCM output reported with native FFmpeg 7.0.2.
for (const graph of [false, true]) {
  for (const padding of ["", ":pad_len=2048"]) {
    for (const [downstream, retained, count] of [
      ["asetrate=2000,atrim=duration=0.006", samples, 12],
      ["asetpts=PTS+4,atrim=end_pts=16", samples, 12],
      ["asetrate=2000,asetpts=PTS+4,atrim=end_pts=16", samples, 12],
      ["asetpts=PTS+4,atrim=start_sample=2:end_pts=16", samples.slice(2), 10]
    ] as const) {
      it(`apad${padding} is bounded by ${downstream} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `apad=packet_size=3${padding},${downstream}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
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

for (const downstream of ["asetpts=0,atrim=end_pts=16", "asetrate=2000,atrim=duration=10"]) {
  it(`bounds padding after ${downstream} and asetpts without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.02 } }).execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `apad=packet_size=3,${downstream}`, "-f", "s16le", "/out.raw"],
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
