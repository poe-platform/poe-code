import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [name, prefix, invalid] of [
  ["space", " ", false],
  ["tab", "\t", false],
  ["mixed ASCII indentation", " \t ", false],
  ["nonbreaking space", "\u00a0", true],
  ["ASCII then nonbreaking space", " \t\u00a0", true],
  ["em space", "\u2003", true],
  ["vertical tab", "\v", true],
  ["form feed", "\f", true]
] as const) {
  for (const explicit of [false, true]) {
    it(`concat keyword indentation: ${name} (explicit=${explicit})`, async () => {
      const manifest = `ffconcat version 1.0\n${prefix}file a.wav\nfile b.wav\n`;
      const volume = Volume.fromJSON({ "/list.ffconcat": manifest, "/out.bin": "keep" });
      for (const [filename, sample] of [["a", 1000], ["b", -2000]] as const) {
        volume.writeFileSync(`/${filename}.wav`, encodeWav({ sampleRate: 8000,
          channels: [new Float64Array(8000).fill(sample / 32768)] }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", ...(explicit ? ["-f", "concat"] : []), "-safe", "0", "-i", "/list.ffconcat", "-c:a", "copy", "-f", "s16le", "/out.bin"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (invalid) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("Line 2:"), stderr);
        assert.equal(volume.readFileSync("/out.bin", "utf8"), "keep");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.bin") as Buffer;
        assert.equal(output.length, 32000);
        assert.deepEqual(Array.from({ length: 16000 }, (_, i) => output.readInt16LE(i * 2)), [
          ...new Array<number>(8000).fill(1000), ...new Array<number>(8000).fill(-2000)
        ]);
      }
    });
  }
}
