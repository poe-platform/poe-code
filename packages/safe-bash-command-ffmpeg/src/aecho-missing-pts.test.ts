import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1001, 0, 0, -2003, 0, 0, 0, 0, 303, 0, 0];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
const source = [560, 0, 248, -1121, 0, 0, 0, 0, -823, 0, 75];
const tail = [0, 0, 150, 0, 0];

// PCM and exact tail timestamps captured from native FFmpeg 7.0.2.
for (const complex of [false, true]) {
  for (const [prefix, untimed, tailPts] of [
    ["asetpts=NAN,", source, -9223372036854775797n],
    ["asetnsamples=n=4:p=0,asetpts=NAN,", source, -9223372036854775805n],
    ["asetnsamples=n=4:p=0,asetpts=if(eq(N\\,8)\\,NAN\\,PTS),", source.slice(8), -9223372036854775805n],
    ["asetnsamples=n=4:p=0,asetpts=if(eq(N\\,4)\\,NAN\\,PTS),", source.slice(4, 8), 11n],
    ["asetnsamples=n=4:p=0,", [], 11n]
  ] as const) {
    for (const [suffix, expected] of [
      ["aselect=isnan(pts)", untimed],
      ["atrim=start=0.011:end=0.016", tailPts < 0 ? [] : tail],
      ["ashowinfo", [...source, ...tail]]
    ] as const) {
      const filter = `${prefix}aecho=0.7:0.8:2|5:0.31|0.62,${suffix}`;
      it(`${filter} matches tail timestamps (${complex ? "complex" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", suffix === "ashowinfo" ? "info" : "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
        if (suffix === "ashowinfo") assert.ok(stderr.includes(`pts:${tailPts} `), stderr);
      });
    }
  }
}
