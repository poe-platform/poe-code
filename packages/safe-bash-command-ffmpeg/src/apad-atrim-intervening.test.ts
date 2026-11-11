import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = [101, 102, 103, 104, 105, 106, 107, 108];
const padded = [...input, 0, 0, 0, 0, 0, 0];
const scaled = [50, 51, 52, 52, 52, 53, 54, 54, 0, 0, 0, 0, 0, 0];

for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["apad=packet_size=2,atrim=end_sample=14", padded],
    ["apad=packet_size=2,anull,atrim=end_sample=14", padded],
    ["apad=packet_size=2,volume=0.5,atrim=end_sample=14", scaled],
    ["apad=packet_size=2,asetnsamples=n=4:p=0,atrim=end_sample=14", padded],
    ["apad=packet_size=2,asetnsamples=n=4:p=1,atrim=end_sample=14", padded],
    ["apad@pad=2,anull@pass,volume@gain=0.5,asetnsamples@frame=4:0,acopy,atrim@trim=end_sample=14", scaled],
    ["apad=2,anull,volume=0.5,atrim=end_pts=14", scaled],
    ["apad=2,anull,atrim=start_sample=4:duration=0.00125", padded.slice(4)],
    ["apad=2,asetnsamples=4:0,atrim=start_sample=10:end_sample=14", [0, 0, 0, 0]],
    ["apad=2,anull,atrim=end_sample=0", []],
    ["apad=2,anull,atrim", null],
    ["apad=2,anull,atrim=end_sample=80000", null],
    ["apad=2,volume=bad,atrim=end_sample=14", null],
    ["apad=2,asetnsamples=n=0,atrim=end_sample=14", null],
    ["apad=2,anull,asetpts=2*PTS,atrim=end_pts=14", input],
    ["apad=2,anull,aresample=16000,atrim=end_sample=14", null],
    ["apad=2,asetnsamples=4:0,atrim=end_pts=14", padded],
    ["apad=2,asetnsamples=4:0,atrim=duration=0.00175", padded],
    ["apad=2,asetnsamples=4:0,atrim=end=10", null],
    ["asetnsamples=3:0,asetpts=2*PTS,apad=2,asetnsamples=4:0,atrim=end_pts=14", null],
    ["asetnsamples=3:0,asetpts=PTS/2,apad=2,asetnsamples=4:0,atrim=duration=0.00175", null],
    ["apad=2,areverse,atrim=end_sample=14", null],
    ["apad=2,aselect=0,atrim=end_sample=14", null]
  ] as const) {
    it(`${filter} preserves finite bounds across filters (${complex ? "complex" : "simple"})`, async () => {
      const bytes = Buffer.alloc(input.length * 2);
      input.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": bytes, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.01 } }).execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const expectedBytes = Buffer.alloc(expected.length * 2);
        expected.forEach((value, index) => expectedBytes.writeInt16LE(value, index * 2));
        assert.deepEqual(volume.readFileSync("/out.raw"), expectedBytes);
      }
    });
  }
}
