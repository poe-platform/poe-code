import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// The reported FFmpeg 7.0.2 fixture uses three-sample frames except for the last frame.
const all = [101, 114, 127, 140, 153, 166, 179, 192, 205, 218];
for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["aselect='gt(t-prev_selected_t,0.0005)+isnan(prev_selected_t)'", [101, 114, 127, 179, 192, 205]],
    ["aselect='eq(selected_n,0)+eq(n,2)'", [101, 114, 127, 179, 192, 205]],
    ["aselect='isnan(prev_selected_n)+eq(n-prev_selected_n,2)'", [101, 114, 127, 179, 192, 205]],
    ["aselect='eq(n,1)+eq(prev_selected_pts,3)'", [140, 153, 166, 179, 192, 205]],
    ["aselect='eq(n,1)+eq(prev_selected_t,3/8000)'", [140, 153, 166, 179, 192, 205]],
    ["aselect='isnan(prev_pts)'", [101, 114, 127]],
    ["aselect='eq(pts-prev_pts,3)'", [140, 153, 166, 179, 192, 205, 218]],
    ["aselect='eq(prev_pts,3)'", [179, 192, 205]],
    ["aselect='eq(prev_t,0.000375)'", [179, 192, 205]],
    ["aselect='not(mod(n,2))'", [101, 114, 127, 179, 192, 205]],
    ["aselect='isnan(prev_t)*isnan(prev_selected_pts)*isnan(prev_selected_t)*isnan(prev_selected_n)*eq(selected_n,0)'", [101, 114, 127]],
    ["aselect='lt(selected_n,2)'", all.slice(0, 6)],
    ["aselect='eq(n,3)*eq(selected_n,0)'", [218]],
    ["asetpts=PTS+7,aselect='eq(prev_pts,10)+eq(prev_selected_pts,13)'", all.slice(6)],
    ["aselect='not(mod(n,2))',aselect='eq(selected_n,0)*isnan(prev_selected_n)*isnan(prev_pts)'", all.slice(0, 3)],
    ["aselect=prev_selected_n", all.slice(0, 3)],
    ["asetpts='if(eq(N,3),NAN,PTS)',aselect='isnan(prev_pts)'", [101, 114, 127, 179, 192, 205]],
    ["asetpts=NAN,aselect='eq(n,1)+eq(selected_n,1)*isnan(prev_selected_pts)*isnan(prev_selected_t)'", all.slice(3, 9)],
    ["atrim=end_sample=0,aselect='isnan(prev_pts)+isnan(prev_t)+isnan(prev_selected_pts)+isnan(prev_selected_t)+isnan(prev_selected_n)+selected_n'", []],
    ["aselect='prev_selected_pts+unknown'", null],
    ["atrim=end_sample=0,aselect='selected_n+unknown'", null]
  ] as const) {
    it(`aselect tracks frame history: ${filter} (${complex ? "complex" : "simple"})`, async () => {
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
