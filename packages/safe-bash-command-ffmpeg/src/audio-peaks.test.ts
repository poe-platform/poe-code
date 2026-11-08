import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodePcm, parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const format of ["f32le", "f64le", "s16le"] as const) {
  for (const container of ["raw", "wav"]) {
    for (const filter of ["anull", "volume=2", "areverse", "extrastereo=2:0", "extrastereo=2:1"]) {
      it(`preserves peaks with ${filter} in ${format} ${container}`, async () => {
        const integerInput = filter === "volume=2";
        const input = Buffer.alloc(integerInput ? 8 : 16);
        if (integerInput) [24576, -24576, 8192, -8192].forEach((value, index) => input.writeInt16LE(value, index * 2));
        else [1.5, -1.5, 0.25, -0.25].forEach((value, index) => input.writeFloatLE(value, index * 4));
        const fs = Volume.fromJSON({ "/in.raw": input });
        const errors: Uint8Array[] = [];
        const stereo = filter.startsWith("extrastereo");
        const result = await createFfmpegCommand().execute({
          args: ["-f", integerInput ? "s16le" : "f32le", "-ar", "8000", "-ac", stereo ? "2" : "1", "-i", "/in.raw",
            "-af", filter, "-c:a", `pcm_${format}`, "-f", container === "raw" ? format : "wav", "/out"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        const output = fs.readFileSync("/out") as Buffer;
        const channels = container === "wav" ? decodePcm(parseAudio(output)).channels : undefined;
        const actual = Array.from({ length: 4 }, (_, i) => channels
          ? channels[i % channels.length]![Math.floor(i / channels.length)]!
          : format === "f32le" ? output.readFloatLE(i * 4)
            : format === "f64le" ? output.readDoubleLE(i * 8) : output.readInt16LE(i * 2) / 32768);
        let expected = filter === "areverse" ? [-0.25, 0.25, -1.5, 1.5]
          : stereo ? [3, -3, 0.5, -0.5] : integerInput ? [1.5, -1.5, 0.5, -0.5] : [1.5, -1.5, 0.25, -0.25];
        if (filter === "extrastereo=2:1") expected = expected.map(value => Math.max(-1, Math.min(1, value)));
        if (format === "s16le") expected = expected.map(value => Math.max(-1, Math.min(32767 / 32768, value)));
        assert.deepEqual(actual, expected);
      });
    }
  }
}
