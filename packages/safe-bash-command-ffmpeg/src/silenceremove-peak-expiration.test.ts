import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 expires the remaining peak when a two-entry queue loses its front.
for (const detection of ["peak", "ptp", "rms", "median"]) {
  for (const window of ["2ms", "0"]) {
    for (const last of [1000, 0]) {
      for (const split of [false, true]) {
        for (const graph of [false, true]) {
          it(`silenceremove ${detection} expires descending peaks (window=${window}, last=${last}, split=${split}, graph=${graph})`, async () => {
            const volume = Volume.fromJSON({});
            volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
              channels: [Float64Array.from([8000, 5000, last], value => value / 32768)] }));
            const filter = (split ? "asetnsamples=n=1:p=0," : "")
              + `silenceremove=stop_periods=-1:window=${window}:stop_threshold=0.1:detection=${detection}`;
            let stderr = "";
            const result = await createFfmpegCommand().execute({
              args: ["-y", "-v", "error", "-i", "/in.wav",
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
            const expected = detection === "rms" && window === "2ms"
              ? last === 1000 ? "401f8813e803" : "401f88130000"
              : "401f8813";
            assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
          });
        }
      }
    }
  }
}
