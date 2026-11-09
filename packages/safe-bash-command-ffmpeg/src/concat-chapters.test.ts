import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [directives, expected] of [
  ["chapter 42 0.25 1.5", [[250000, 1500000]]],
  ["chapter 5 0 0.25\nchapter 19 0.25 2", [[0, 250000], [250000, 2000000]]],
  ["chapter 42 250ms 00:01.5", [[250000, 1500000]]],
  ["chapter 5 1 0", null],
  ["chapter 5 invalid 1", null],
  ["chapter 5 0", null],
  ["chapter invalid 0 1", null]
] as const) {
  for (const format of ["ffmetadata", "s16le"]) {
    it(`concat ${directives} exported as ${format}`, async () => {
      const volume = Volume.fromJSON({
        "/list.ffconcat": `ffconcat version 1.0\n${directives}\nfile a.wav\nfile b.wav\n`,
        "/out.bin": "keep"
      });
      const samples = new Float64Array(8000).fill(0.25);
      volume.writeFileSync("/a.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
      volume.writeFileSync("/b.wav", encodeWav({ sampleRate: 8000, channels: [samples.map(value => -value)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "/list.ffconcat", "-c:a", "copy", "-f", format, "/out.bin"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.bin", "utf8"), "keep");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        if (format === "ffmetadata") {
          const output = volume.readFileSync("/out.bin", "utf8") as string;
          assert.deepEqual(output.split("[CHAPTER]\n").slice(1).map(section => section.trim()), expected.map(([start, end]) =>
            `TIMEBASE=1/1000000\nSTART=${start}\nEND=${end}`));
        } else {
          const expectedBytes = Buffer.alloc(32000);
          for (let i = 0; i < 16000; i++) expectedBytes.writeInt16LE(i < 8000 ? 8192 : -8192, i * 2);
          assert.deepEqual(volume.readFileSync("/out.bin"), expectedBytes);
        }
      }
    });
  }
}
