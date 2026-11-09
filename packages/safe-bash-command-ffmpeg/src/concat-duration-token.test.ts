import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [directive, start, end] of [
  ["inpoint", 2000, 8000],
  ["outpoint", 0, 2048],
  ["duration", 0, 8000]
] as const) {
  for (const value of ["0.25", "0.25 # offset", "0.25 ignored", "\t0.25\tignored", "0.25junk ignored", "invalid # offset", "# missing", ""]) {
    const invalid = !value.trimStart().startsWith("0.25") || value.startsWith("0.25junk");
    const channels = 1;
    it(`concat ${directive} reads one duration token from ${JSON.stringify(value)}`, async () => {
      const volume = Volume.fromJSON({
        "/list.ffconcat": `ffconcat version 1.0\nfile a.wav\n${directive} ${value}\nfile b.wav\n`,
        "/out.bin": "keep"
      });
      for (const name of ["a", "b"]) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
          channels: Array.from({ length: channels }, (_, channel) =>
            Float64Array.from({ length: 8000 }, (_, i) => (name === "a" ? i + channel * 8000 : -2000 - channel) / 32768)) }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "/list.ffconcat", "-c:a", "copy", "-f", "s16le", "/out.bin"],
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
        assert.ok(stderr.includes(`invalid ${directive}`), stderr);
        assert.equal(volume.readFileSync("/out.bin", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc((end - start + 8000) * channels * 2);
      for (let frame = 0; frame < end - start + 8000; frame++) {
        for (let channel = 0; channel < channels; channel++) {
          expected.writeInt16LE(frame < end - start ? start + frame + channel * 8000 : -2000 - channel,
            (frame * channels + channel) * 2);
        }
      }
      const actual = volume.readFileSync("/out.bin") as Buffer;
      assert.equal(actual.length, expected.length);
      assert.equal(actual.readInt16LE(), expected.readInt16LE());
      assert.deepEqual(actual, expected);
    });
  }
}
