import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [filter, samples] of [
    ["asetpts=PTS-STARTT/TB,atrim=end_pts=6", [1, 2, 3, 4, 5, 6]],
    ["asetpts=PTS,atrim=end_pts=6", [1, 2, 3, 4, 5, 6]],
    ["asetpts=PTS+8,asetpts=PTS-STARTT/TB,atrim=end_pts=6", [1, 2, 3, 4, 5, 6]],
    ["asetpts=PTS+8,asetpts=PTS-STARTPTS,atrim=end_pts=6", [1, 2, 3, 4, 5, 6]],
    ["asetpts=PTS-8,asetpts=PTS-STARTT/TB,atrim=end_pts=6", [1, 2, 3, 4, 5, 6]],
    ["atrim=start_sample=3,asetpts=PTS-STARTT/TB,atrim=end_pts=6", [4, 5, 6, 7, 8, 9]],
    ["atrim=end_sample=0,asetpts=PTS-STARTT/TB", []]
  ] as const) {
    it(`resolves STARTT in seconds through ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(24);
      for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chain = `asetnsamples=3:0,${filter},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[s]`, "-map", "[s]"] : ["-af", chain]),
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), samples);
      assert.deepEqual(stderr.split("\n").filter(line => line.includes("nb_samples:")).map(line =>
        Number(line.split(" ").find(field => field.startsWith("pts:"))!.slice(4))), samples.length ? [0, 3] : []);
    });
  }
}
