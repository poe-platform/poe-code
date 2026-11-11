import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: two silent intervals in three frames of mono PCM16.
const input = Buffer.from("004000000000000000000040000000000000", "hex");
for (const graph of [false, true]) {
  for (const limit of [0, 1, 2, 3, undefined]) {
    for (const offset of [0, 0.01]) {
      it(`silencedetect stops at the consumed frame (limit=${limit}, offset=${offset}, graph=${graph})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=3:p=0,asetpts=PTS+${offset}/TB,silencedetect=n=0.1:d=0.00025`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...(limit === undefined ? [] : ["-frames:a", String(limit)]), "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(0, (limit ?? 3) * 6));
        const time = (value: number) => Number((offset + value).toPrecision(6));
        const events = [
          `silence_start: ${time(0.000125)}`,
          (limit === 0 || limit === 1)
            ? `silence_end: ${time(0.000375)} | silence_duration: 0.00025`
            : `silence_end: ${time(0.000625)} | silence_duration: 0.0005`,
          ...(limit === 3 || limit === undefined ? [
            `silence_start: ${time(0.00075)}`,
            `silence_end: ${time(0.001125)} | silence_duration: 0.000375`
          ] : [])
        ];
        assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), events);
      });
    }
  }
}
