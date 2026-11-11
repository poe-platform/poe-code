import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static: 29 mono PCM16 samples at 8 kHz, with input PTS offset by 10.
for (const graph of [false, true]) {
  for (const timed of [false, true]) {
    for (const select of [false, true]) {
      it(`aloop preserves native offset timestamps (timed=${timed}, select=${select}, graph=${graph})`, async () => {
        const samples = Array.from({ length: 29 }, (_, i) => i + 1);
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=8:p=0,asetpts=PTS+10,aloop=1:4:${timed ? "-1:0.002" : "0"}${select ? ",aselect='lt(t,0.001)'" : ""},ashowinfo`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
        const frames = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
          const fields = line.split(" ");
          return [Number(fields.find(field => field.startsWith("pts:"))!.slice(4)),
            Number(fields.find(field => field.startsWith("nb_samples:"))!.slice(11))];
        });
        assert.deepEqual(frames, select ? (timed ? [[0, 4], [4, 4]] : []) : timed
          ? [[0, 4], [4, 4], [18, 4], [22, 4], [26, 4], [30, 8], [38, 5]]
          : [[10, 4], [14, 4], [18, 4], [22, 8], [30, 8], [38, 5]]);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          select ? (timed ? samples.slice(0, 8) : []) : timed
            ? [...samples.slice(0, 12), ...samples.slice(8)]
            : [...samples.slice(0, 4), ...samples]);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
