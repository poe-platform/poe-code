import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2]) {
  for (const complex of [false, true]) {
    for (const [pts, trim, samples, frames] of [
      ["PTS/2", "duration=0.0005", [1, 2, 3, 4, 5, 6, 7], [[0, 3], [1, 3], [3, 1]]],
      ["mod(PTS\\,6)", "start_sample=1:duration=0.0005", [2, 3, 4, 5, 7, 8, 9, 10, 11], [[1, 2], [3, 2], [0, 3], [3, 2]]],
      ["PTS", "duration=0.0005", [1, 2, 3, 4], [[0, 3], [3, 1]]],
      ["PTS/2+8", "start=0:duration=0.0005", [], []]
    ] as const) {
      it(`atrim=${trim} applies ${pts} timestamps per frame (${channels} channels, ${complex ? "complex" : "simple"})`, async () => {
        const input = Buffer.alloc(12 * channels * 2);
        for (let i = 0; i < 12; i++) {
          for (let c = 0; c < channels; c++) input.writeInt16LE((c ? -1 : 1) * (i + 1), (i * channels + c) * 2);
        }
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=3:0,asetpts=${pts},atrim=${trim},ashowinfo`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "info", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
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
          samples.flatMap(value => channels === 1 ? [value] : [value, -value]));
        const actualFrames = stderr.split("\n").filter(line => line.includes("nb_samples:")).map(line => {
          const fields = line.split(" ");
          return [Number(fields.find(field => field.startsWith("pts:"))!.slice(4)),
            Number(fields.find(field => field.startsWith("nb_samples:"))!.slice(11))];
        });
        assert.deepEqual(actualFrames, frames);
      });
    }
  }
}
