import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: the EOF silence_end is logged but has no frame metadata.
for (const graph of [false, true]) {
  for (const mode of ["combined", "mono", "control"] as const) {
    it(`publishes native silence metadata (${mode}, graph=${graph})`, async () => {
      const samples = [...Array<number>(8).fill(0), ...Array<number>(4).fill(8000), ...Array<number>(4).fill(0)];
      const input = encodeWav({ sampleRate: 8, channels: [Float64Array.from(samples, value => value / 32768)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `asetnsamples=n=4:p=0,${mode === "control"
        ? "ametadata=mode=add:key=sample:value=present"
        : `silencedetect=d=0.25${mode === "mono" ? ":m=1" : ""}`},ametadata=mode=print`;
      let stderr = "";
      const output: Buffer[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-loglevel", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => expected.writeInt16LE(sample, i * 2));
      assert.deepEqual(Buffer.concat(output), expected);
      const lines = stderr.trim().split("\n");
      const suffix = mode === "mono" ? ".1" : "";
      assert.deepEqual(lines.filter(line => line.startsWith("lavfi.") || line === "sample=present"), mode === "control"
        ? Array<string>(4).fill("sample=present")
        : [`lavfi.silence_start${suffix}=0`, `lavfi.silence_end${suffix}=1`,
          `lavfi.silence_duration${suffix}=1`, `lavfi.silence_start${suffix}=1.5`]);
      assert.deepEqual(lines.filter(line => line.startsWith("frame:")).map(line => line.split(/\s+/)),
        (mode === "control" ? [0, 1, 2, 3] : [0, 2, 3]).map(n => [`frame:${n}`, `pts:${n * 4}`, `pts_time:${n / 2}`]));
      const prefix = mode === "mono" ? "channel: 0 | " : "";
      assert.deepEqual(lines.filter(line => line.startsWith("silence_") || line.startsWith("channel:")),
        mode === "control" ? [] : ["silence_start: 0", "silence_end: 1 | silence_duration: 1",
          "silence_start: 1.5", "silence_end: 2 | silence_duration: 0.5"].map(line => prefix + line));
    });
  }
}
