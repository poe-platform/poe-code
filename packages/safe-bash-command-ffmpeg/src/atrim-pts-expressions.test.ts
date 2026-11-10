import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [filter, start, end] of [
    ["atrim=start_pts=2+3", 5, 12],
    ["atrim=end_pts=2+3", 0, 5],
    ["atrim=start_pts=2.5", 2, 12],
    ["atrim=start_pts=3.5", 4, 12],
    ["atrim=end_pts=2.5", 0, 2],
    ["atrim=end_pts=3.5", 0, 4],
    ["asetpts=PTS-8,atrim=start_pts=-2.5:end_pts=-0.5", 6, 8],
    ["asetpts=PTS-8,atrim=start_pts=-3.5:end_pts=-1.5", 4, 6],
    ["atrim=start_pts=0x2", 2, 12],
    ["atrim=end_pts=0x2", 0, 2],
    ["atrim=start_pts=sqrt(4):end_pts=2*3", 2, 6],
    ["atrim=end_pts=3", 0, 3],
    ["atrim=start_pts=0b10", -1, 0],
    ["atrim=start_pts=0o2", -1, 0],
    ["atrim=end_pts=0b10", -1, 0],
    ["atrim=end_pts=0o2", -1, 0],
    ["atrim=start_pts=1/0", -1, 0],
    ["atrim=end_pts=0/0", -1, 0]
  ] as const) {
    it(`${filter} parses integer option expressions (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(24);
      for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
      const existing = Buffer.from([255, 127]);
      for (const outputExists of start < 0 ? [false, true] : [false]) {
        const volume = Volume.fromJSON({ "/in.raw": input,
          ...(outputExists ? { "/out.raw": existing } : {}) });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
        if (start < 0) {
          assert.equal(result.exitCode, 1, stderr);
          assert.ok(stderr.includes("atrim: invalid"), stderr);
          if (outputExists) assert.deepEqual(volume.readFileSync("/out.raw"), existing);
          else assert.equal(volume.existsSync("/out.raw"), false);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(start * 2, end * 2));
        }
      }
    });
  }
}
