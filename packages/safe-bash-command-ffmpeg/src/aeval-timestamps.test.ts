import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: t follows frame PTS; n counts samples reaching aeval.
for (const [prefix, expression, expected] of [
  ["", "t*s/32768", [0, 1, 2, 3, 4, 5, 6, 7]],
  ["asetpts=PTS+16,", "t*s/32768", [16, 17, 18, 19, 20, 21, 22, 23]],
  ["asetpts=PTS-16,", "t*s/32768", [-16, -15, -14, -13, -12, -11, -10, -9]],
  ["atrim=start_sample=3,", "t*s/32768", [3, 4, 5, 6, 7]],
  ["asetnsamples=n=2:p=0,asetpts=2*PTS,", "t*s/32768", [0, 1, 4, 5, 8, 9, 12, 13]],
  ["asetnsamples=n=3:p=0,asetpts=PTS+16,", "t*s/32768", [16, 17, 18, 19, 20, 21, 22, 23]],
  ["asettb=1/4000,asetpts=PTS+8,", "t*s/32768", [16, 17, 18, 19, 20, 21, 22, 23]],
  ["asetpts=NAN,", "isnan(t)", [32767, 32767, 32767, 32767, 32767, 32767, 32767, 32767]]
] as const) {
  for (const complex of [false, true]) {
    for (const enable of ["", ":enable=1"]) {
      it(`aeval uses frame timestamps: ${prefix || "unshifted"} (${complex ? "graph" : "simple"}${enable})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from([100, 200, 300, 400, 500, 600, 700, 800], sample => sample / 32768)] }));
        const filter = `${prefix}aeval=n/32768|${expression}${enable}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          expected.flatMap((sample, n) => [n, sample]));
      });
    }
  }
}
