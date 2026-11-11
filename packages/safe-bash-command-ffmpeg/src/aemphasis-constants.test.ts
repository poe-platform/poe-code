import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete stereo PCM16 output from native FFmpeg 7.0.2.
for (const options of ["level_in=1:level_out=1:type=cd", "level_in=max/64", "level_out=default", "type=default",
  "level_in=default:level_out=max/64:mode=default:type=max/2",
  "level_in=min+1:level_out=min+1:mode=min:type=min+4",
  "level_in=2:level_in=default", "max/64:default:default:default"]) {
  for (const complex of [false, true]) {
    it(`preserves stereo PCM with aemphasis ${options || "control"} (${complex ? "graph" : "simple"})`, async () => {
      const samples = [1001, 0, 0, -501, ...Array(12).fill(0), 2001, 301, ...Array(14).fill(0)];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `aemphasis${options ? `=${options}` : ""}`;
      const chunks: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
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
      const pcm = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
        [330, 0, 343, -165, 67, -171, 140, -34, 43, -70, 44, -21, 34, -22, 6, -17, 683, 96, 680, 91, 149, 23, 274, 34, 93, 15, 86, 9, 70, 11, 11, 0]);
    });
  }
}

for (const [argument, exitCode] of [
  ["level_in=max+1", 222], ["level_out=min-1", 222], ["type=max+1", 222],
  ["type=min", 8], ["mode=max+1", 222]
] as const) {
  it(`rejects aemphasis=${argument} without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.alloc(16), "/out.raw": "existing" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `aemphasis=${argument}`, "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.match(stderr, /aemphasis:/);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "existing");
  });
}
