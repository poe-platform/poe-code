import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: a 1 ms input offset is eight ticks at 8000 Hz.
for (const graph of [false, true]) {
  for (const [offset, filter, expectedPts, reversed, empty] of [
    [undefined, "ashowinfo", 0, false, false],
    ["0.001", "ashowinfo", 8, false, false],
    ["0.001", "areverse,ashowinfo", 8, true, false],
    ["0.001", "asetpts=PTS-STARTPTS,ashowinfo", 0, false, false],
    ["0.001", "areverse,asetpts=PTS-STARTPTS,ashowinfo", 0, true, false],
    ["0.001", "atrim=end_pts=4,ashowinfo", 0, false, true]
  ] as const) {
    it(`reports input offset ${offset ?? "none"} through ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const samples = [1, 2, 3, 4, 5, 6, 7, 8];
      const input = Buffer.alloc(samples.length * 2);
      for (const [i, sample] of samples.entries()) input.writeInt16LE(sample, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1",
          ...(offset === undefined ? [] : ["-itsoffset", offset]), "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.bin"],
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
      const output = volume.readFileSync("/out.bin") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        empty ? [] : reversed ? [...samples].reverse() : samples);
      const frames = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
      assert.equal(frames.length, empty ? 0 : 1, stderr);
      if (!empty) assert.ok(frames[0]!.startsWith(`[ashowinfo] n:0 pts:${expectedPts} pts_time:${expectedPts / 8000} `), stderr);
    });
  }
}
