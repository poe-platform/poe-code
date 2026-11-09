import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: the reported clips are mono PCM16 ramps at 8 kHz.
// Failed concat seeking discards the 512-frame packet buffered during probing.
for (const codec of ["copy", "pcm_s16le"]) {
  for (const durations of ["none", "first", "both", "outpoints"] as const) {
    for (const seek of [0, 0.01, 1.27]) {
      for (const level of ["warning", "error"]) {
        it(`concat ${codec} seek ${seek}, durations ${durations}, log level ${level}`, async () => {
          const seekable = durations === "both" || durations === "outpoints";
          const failedSeek = seek !== 0 && !seekable;
          const first = failedSeek && codec === "copy" ? 512 : Math.max(failedSeek ? 512 : 0, Math.round(seek * 8000));
          const manifest = "ffconcat version 1.0\n" + ["a", "b"].map((name, i) =>
            `file ${name}.wav\n${durations === "both" || durations === "first" && i === 0 ? "duration 1\n" :
              durations === "outpoints" ? "inpoint 0\noutpoint 1\n" : ""}`).join("");
          const volume = Volume.fromJSON({ "/list.ffconcat": manifest });
          const expected = Buffer.alloc((16000 - first) * 2);
          for (let i = first; i < 16000; i++) {
            expected.writeInt16LE(i < 8000 ? i : i + 2000, (i - first) * 2);
          }
          for (const [i, name] of ["a", "b"].entries()) {
            volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
              channels: [Float64Array.from({ length: 8000 }, (_, frame) => (i * 10000 + frame) / 32768)] }));
          }
          let stderr = "";
          const output: Uint8Array[] = [];
          const result = await createFfmpegCommand().execute({
            args: ["-v", level, "-f", "concat", "-ss", String(seek), "-i", "/list.ffconcat", "-c", codec, "-f", "s16le", "-"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { output.push(bytes.slice()); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr.includes(`could not seek to position ${seek.toFixed(3)}`), failedSeek && level === "warning", stderr);
          const actual = Buffer.concat(output);
          assert.equal(actual.length, expected.length);
          assert.equal(actual.readInt16LE(), expected.readInt16LE());
          assert.deepEqual(actual, expected);
        });
      }
    }
  }
}
