import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const bom of [false, true]) {
  for (const existingOutput of [false, true]) {
    it(`concat PCM copy with BOM=${bom} and existing output=${existingOutput}`, async () => {
      const volume = Volume.fromJSON({
        "/list.ffconcat": `${bom ? "\ufeff" : ""}ffconcat version 1.0\nfile a.wav\nfile b.wav\n`
      });
      const expected = Buffer.alloc(32000);
      for (const [index, name, sample] of [[0, "a", 1000], [1, "b", -2000]] as const) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
          channels: [new Float64Array(8000).fill(sample / 32768)] }));
        for (let frame = 0; frame < 8000; frame++) expected.writeInt16LE(sample, (index * 8000 + frame) * 2);
      }
      if (existingOutput) volume.writeFileSync("/out.pcm", "KEEP");
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "concat", "-i", "/list.ffconcat", "-c", "copy", "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (bom) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("Line 1: unknown keyword '\ufeffffconcat'"), stderr);
        if (existingOutput) assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
        else assert.equal(volume.existsSync("/out.pcm"), false);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.pcm"), expected);
      }
    });
  }
}
