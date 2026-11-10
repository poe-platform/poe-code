import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// The reported FFmpeg 7.0.2 fixture uses three-sample frames except for the last frame.
const all = [101, 114, 127, 140, 153, 166, 179, 192, 205, 218];
for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["asetpts=PTS+7,aselect='eq(pts,10)'", [140, 153, 166]],
    ["asetpts=PTS+7,aselect='eq(t,10/8000)'", [140, 153, 166]],
    ["asetpts=PTS+7,aselect='eq(start_pts,7)'", all],
    ["asetpts=PTS+7,aselect='eq(start_t,7/8000)'", all],
    ["aselect='eq(TB,1/8000)'", all],
    ["aselect='eq(pts,3)'", [140, 153, 166]],
    ["aselect='eq(n,1)'", [140, 153, 166]],
    ["asetpts=PTS-7,aselect='eq(pts,-4)'", [140, 153, 166]],
    ["asetpts=PTS-7,aselect='eq(start_pts,-7)*eq(start_t,-7/8000)'", all],
    ["asetpts=PTS+7,aselect='eq(pts,16)'", [218]],
    ["aselect='gte(n,1)',aselect='eq(start_pts,3)*eq(start_t,3/8000)'", all.slice(3)],
    ["asetpts=NAN,aselect='isnan(pts)*isnan(t)*isnan(start_pts)*isnan(start_t)'", all],
    ["asetpts='if(eq(N,0),NAN,PTS+7)',aselect='isnan(start_pts)'", all.slice(0, 3)],
    ["asetpts='if(eq(N,0),NAN,PTS+7)',aselect='eq(start_pts,10)*eq(start_t,10/8000)'", all.slice(3)],
    ["asetpts='if(eq(N,3),NAN,PTS+7)',aselect='eq(start_pts,7)*eq(start_t,7/8000)'", all],
    ["asetpts=NAN,aselect=pts", all],
    ["atrim=end_sample=0,aselect='isnan(pts)*isnan(start_pts)*isnan(start_t)*eq(TB,1/8000)'", []],
    ["aselect='eq(pts,10)+unknown'", null],
    ["atrim=end_sample=0,aselect='eq(TB,1/8000)+unknown'", null]
  ] as const) {
    it(`aselect reads incoming timing: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(all.length * 2);
      for (const [i, sample] of all.entries()) input.writeInt16LE(sample, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
      const before = volume.toJSON();
      const chain = `asetnsamples=n=3:p=0,${filter}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[o]`, "-map", "[o]"] : ["-af", chain]),
          "-f", "s16le", "/out.dat"],
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
        assert.ok(stderr.includes("aselect:"), stderr);
        assert.deepEqual(volume.toJSON(), before);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.dat") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      }
    });
  }
}
