import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: the flush frame keeps the latest input PTS minus
// buffered resampler delay, including when startup emitted no audio.
for (const [length, expression, frames] of [
  [29, "PTS*2", [[39, 39]]],
  [29, "PTS", [[0, 39]]],
  [29, "PTS*2-188", [[-221, 39]]],
  [29, "NAN", [[0, 39]]],
  [70, "PTS*2", [[39, 27], [75, 9], [94, 10], [114, 10], [133, 9], [152, 10], [162, 22]]],
  [70, "PTS", [[0, 27], [27, 9], [36, 10], [46, 10], [56, 9], [65, 10], [75, 22]]],
  [70, "PTS/2", [[-19, 27], [2, 9], [7, 10], [12, 10], [17, 9], [21, 10], [31, 22]]]
] as const) {
  for (const format of ["", ":osf=s16"]) {
    for (const type of ["in", "out"]) {
      for (const graph of [false, true]) it(`resamples ${length} samples with ${expression} before fade ${type} (${format || "negotiated"}, graph=${graph})`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [new Float64Array(length).fill(16000 / 32768)] }));
        const filter = `asetnsamples=n=7:p=0,asetpts=${expression},aresample=11025${format},ashowinfo,afade=t=${type}:ns=25`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "info", "-i", "/in.wav",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const reports = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
        assert.equal(reports.length, frames.length, stderr);
        frames.forEach(([pts, count], n) => {
          assert.ok(reports[n]!.includes(` n:${n} pts:${pts} `), stderr);
          assert.ok(reports[n]!.includes(" fmt:s16 "), stderr);
          assert.ok(reports[n]!.includes(` nb_samples:${count} `), stderr);
        });
        if (length === 29) assert.ok(reports[0]!.includes(" checksum:7C9A1CF2 "), stderr);
        const output = fs.readFileSync("/out.raw") as Buffer;
        const expected = frames.flatMap(([pts, count]) => Array.from({ length: count }, (_, i) =>
          640 * Math.max(0, Math.min(25, type === "in" ? pts + i : 25 - pts - i))));
        assert.equal(output.length, expected.length * 2);
        assert.deepEqual(Array.from({ length: expected.length }, (_, i) => output.readInt16LE(i * 2)), expected);
      });
    }
  }
}
