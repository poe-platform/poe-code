import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static: ten mono PCM16 samples at 1 kHz.
const samples = Array.from({ length: 10 }, (_, i) => (i + 1) * 1000);
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));

for (const graph of [false, true]) {
  for (const [prefix, time, expected] of [
    ...["", "asetnsamples=n=3:p=0,", "asetnsamples=n=3:p=0,asettb=1/2000,"].flatMap(prefix => ([
      ["0.002", [...samples.slice(0, 8), ...samples.slice(4)]],
      ["0.004", [...samples.slice(0, 8), ...samples.slice(4)]],
      ["0", [...samples.slice(0, 4), ...samples]],
      ["0.020", samples],
      ["0.009", samples],
      ["0.008", [...samples, ...samples.slice(8)]]
    ] as const).map(([time, expected]) => [prefix, time, expected] as const)),
    ["asetnsamples=n=3:p=0,asetpts=PTS+4,", "0.002", [...samples.slice(0, 4), ...samples]],
    ["asetnsamples=n=3:p=0,asetpts=2*PTS,", "0.008", [...samples, ...samples.slice(8)]],
    ["asetnsamples=n=3:p=0,asetpts=NAN,", "0", samples]
  ] as const) {
    it(`aloop time=${time} selects native chunks after ${prefix || "input"} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `${prefix}aloop=loop=1:size=4:start=-1:time=${time}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
